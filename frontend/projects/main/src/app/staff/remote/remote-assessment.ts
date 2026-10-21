import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { num, text } from '../assessment/assessment-shared';
import { FinalSubmitCheck, Meeting, PhotoTarget, RemoteApi, RemoteDetails, RemotePhoto, Row } from './remote.api';
import { TwilioParticipant, TwilioRoom, TwilioTrack, loadTwilioVideo } from './twilio-video';

export type RemoteTab = 'overview' | 'openMeeting' | 'basicInfo' | 'siteTour' | 'parameters' | 'closeMeeting';

export const TABS: { id: RemoteTab; no: number; title: string }[] = [
  { id: 'overview', no: 1, title: 'Assessment Overview' },
  { id: 'openMeeting', no: 3, title: 'Opening Meeting' },
  { id: 'basicInfo', no: 4, title: 'Basic Info' },
  { id: 'siteTour', no: 2, title: 'Site Tour' },
  { id: 'parameters', no: 5, title: 'Parameters' },
  { id: 'closeMeeting', no: 6, title: 'Closing Meeting' },
];

/** Basic Info rows: DA answer column, remote answer column, Yes/No choice. */
export const BASIC_INFO: { label: string; da: string; sa: string; yesNo: boolean }[] = [
  { label: 'Whether 3rd Party Financial Audits are conducted?', da: 'AuditsConducted', sa: 'SaAuditsConducted', yesNo: true },
  { label: 'Key Domestic Customers', da: 'DomesticCustomers', sa: 'SaDomesticCustomers', yesNo: false },
  { label: 'Key International Customers', da: 'InternationalCustomers', sa: 'SaInternationalCustomers', yesNo: false },
  { label: 'Processed Outsourced, if any?', da: 'OutsourcedProcesses', sa: 'SaOutsourcedProcesses', yesNo: false },
  { label: 'Energy Source(s) Used', da: 'EnergySources', sa: 'SaEnergySources', yesNo: false },
  { label: 'Manufacturing Capacity Units', da: 'ManufacturingCapacityUnits', sa: 'SaManufacturingCapacityUnits', yesNo: false },
  { label: 'Manufacturing Capacity Value', da: 'ManufacturingCapacityValue', sa: 'SaManufacturingCapacityValue', yesNo: false },
  { label: 'Monthly Utilization Units', da: 'MonthlyUtilizationUnits', sa: 'SaMonthlyUtilizationUnits', yesNo: false },
  { label: 'Monthly Utilization Value', da: 'MonthlyUtilizationValue', sa: 'SaMonthlyUtilizationValue', yesNo: false },
];

interface Capture { target: PhotoTarget; targetId: number | null; image: string; name: string; fixedName: boolean }
interface Choice { kind: 'conformance' | 'product' | 'siteExterior'; id: number | null; title: string; value: string; remarks: string; max: number }
interface TextEdit { kind: 'basicInfo' | 'ofi' | 'meeting'; id: number | null; column: string; title: string; value: string; yesNo: boolean }
interface FinalSubmitEdit { check: FinalSubmitCheck; comments: string; confirmed: boolean }

type VideoState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

/**
 * The site assessor's remote (video) assessment of a unit. Port of Views/Remote/Index.cshtml: unit
 * overview, opening/closing meeting (participants, comments, photo), basic info answers, site tour photos,
 * parameter conformance with evidence photos, product and site exterior validation, final submit, and the
 * Twilio video call with the MSME's RA app ("Start Assessment"). Photos are frames captured from the
 * MSME's video. Tabs and pop-ups are signal-controlled markup; nothing from the server is rendered as HTML.
 */
@Component({
  selector: 'zed-staff-remote-assessment',
  imports: [FormsModule, RouterLink],
  templateUrl: './remote-assessment.html',
  styleUrl: './remote-assessment.css',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
})
export class RemoteAssessmentPage {
  private readonly api = inject(RemoteApi);
  private readonly params = inject(ActivatedRoute).snapshot.paramMap;
  protected readonly zedId = this.params.get('zedId') ?? '';
  protected readonly certification = this.params.get('certification') ?? '';

  protected readonly t = text;
  protected readonly n = num;
  protected readonly tabs = TABS;
  protected readonly basicInfo = BASIC_INFO;

  protected readonly data = signal<RemoteDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly modalError = signal('');
  protected readonly tab = signal<RemoteTab>('overview');
  protected readonly preview = signal<string | null>(null);

  protected readonly capture = signal<Capture | null>(null);
  protected readonly choice = signal<Choice | null>(null);
  protected readonly textEdit = signal<TextEdit | null>(null);
  protected readonly fromTourFor = signal<number | null>(null);
  protected readonly finalSubmit = signal<FinalSubmitEdit | null>(null);
  protected participant: Record<string, { name: string; designation: string }> = {
    open: { name: '', designation: '' },
    close: { name: '', designation: '' },
  };

  protected readonly videoState = signal<VideoState>('idle');
  protected readonly videoError = signal('');
  protected readonly seconds = signal(0);
  private room: TwilioRoom | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly output = viewChild<ElementRef<HTMLElement>>('output');

  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly canAssess = computed(() => this.data()?.permissions.canAssess ?? false);
  protected readonly currentTab = computed(() => TABS.find((x) => x.id === this.tab())!);
  protected readonly daSelfies = computed(() => (this.data()?.daPhotos ?? []).filter((p) => text(p, 'PhotoType') === 'Selfie'));
  protected readonly daSiteExterior = computed(() => (this.data()?.daPhotos ?? []).filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos'));
  protected readonly timerText = computed(() => {
    const s = this.seconds();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
  protected readonly mapUrl = computed(() => {
    const l = this.data()?.location;
    const lat = Number(l?.['Latitude']);
    const lng = Number(l?.['Longitude']);
    return l?.['Latitude'] && Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '';
  });
  /** Products and parameters marked "No" (shown in the final-submit pop-up). */
  protected readonly ncProducts = computed(() => (this.data()?.products ?? []).filter((p) => text(p, 'IsSaVerified') === 'No'));
  protected readonly ncRequirements = computed(() => (this.data()?.requirements ?? []).filter((r) => text(r, 'SaConformance') === 'No'));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.leaveRoom());
    void this.load();
  }

  // ------------------------------------------------------------------ data

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await firstValueFrom(this.api.details(this.zedId, this.certification)));
      this.error.set('');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected refresh(): void {
    this.notice.set(null);
    void this.load();
  }

  /** Runs a change, closes the pop-up and reloads; errors stay in the pop-up (or the page when none is open). */
  private async run(call: Observable<unknown>, close: () => void, inModal = true): Promise<boolean> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(call);
      close();
      await this.load();
      return true;
    } catch (err) {
      if (inModal) this.modalError.set(apiErrorMessage(err));
      else this.notice.set({ ok: false, text: apiErrorMessage(err) });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ view helpers

  protected requirementsOf(section: Row): Row[] {
    return (this.data()?.requirements ?? []).filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row): Row[] {
    return (this.data()?.options ?? []).filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected subOptionsOf(o: Row): Row[] {
    return (this.data()?.subOptions ?? []).filter(
      (s) => text(s, 'SectionCode') === text(o, 'SectionCode') && text(s, 'RequirementCode') === text(o, 'RequirementCode') && text(s, 'OptionCode') === text(o, 'OptionCode'),
    );
  }

  protected evidencesOf(r: Row): Row[] {
    return (this.data()?.evidences ?? []).filter((e) => text(e, 'SectionCode') === text(r, 'SectionCode') && text(e, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected photosOf(row: Row): RemotePhoto[] {
    return (row['RemotePhotos'] as RemotePhoto[] | undefined) ?? [];
  }

  protected productPhotos(p: Row, name: string): RemotePhoto[] {
    return this.photosOf(p).filter((x) => x.name === name);
  }

  protected exempted(section: Row): boolean {
    return text(section, 'IsAssessmentExcempted') === 'Yes';
  }

  protected id(row: Row): number {
    return num(row, 'Id');
  }

  protected section(r: Row): Row | undefined {
    return (this.data()?.sections ?? []).find((s) => text(s, 'SectionCode') === text(r, 'SectionCode'));
  }

  // ------------------------------------------------------------------ video

  protected async startAssessment(): Promise<void> {
    if (this.videoState() === 'connecting' || this.room) return;
    this.videoState.set('connecting');
    this.videoError.set('');
    try {
      const join = await firstValueFrom(this.api.join(this.zedId, this.certification));
      const video = await loadTwilioVideo();
      const room = await video.connect(join.token, { audio: true, video: { width: 400 } });
      this.room = room;
      this.videoState.set(room.participants.size ? 'connected' : 'waiting');
      this.timer = setInterval(() => this.seconds.update((s) => s + 1), 1000);
      room.participants.forEach((p) => this.participantConnected(p));
      room.on('participantConnected', (p) => this.participantConnected(p));
      room.on('participantDisconnected', (p) => this.participantDisconnected(p));
      room.once('disconnected', () => room.participants.forEach((p) => this.participantDisconnected(p)));
    } catch (err) {
      this.videoState.set('error');
      this.videoError.set(err instanceof Error ? err.message : apiErrorMessage(err));
    }
  }

  private participantConnected(participant: TwilioParticipant): void {
    this.videoState.set('connected');
    const host = this.output()?.nativeElement;
    if (!host) return;
    const div = document.createElement('div');
    div.id = 'p-' + participant.sid;
    host.appendChild(div);
    participant.on('trackSubscribed', (track) => div.appendChild(track.attach()));
    participant.on('trackUnsubscribed', (track: TwilioTrack) => track.detach().forEach((el) => el.remove()));
    participant.tracks.forEach((pub) => {
      if (pub.isSubscribed && pub.track) div.appendChild(pub.track.attach());
    });
  }

  private participantDisconnected(participant: TwilioParticipant): void {
    const host = this.output()?.nativeElement;
    if (host) [...host.children].find((c) => c.id === 'p-' + participant.sid)?.remove();
    if (this.room && this.room.participants.size === 0) this.videoState.set('waiting');
  }

  private leaveRoom(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.room?.disconnect();
    this.room = null;
  }

  // ------------------------------------------------------------------ photos

  /** Captures the current frame of the MSME's video with a time stamp (as the old page did). */
  protected captureImage(target: PhotoTarget, targetId: number | null, defaultName: string, fixedName = false): void {
    this.notice.set(null);
    const video = this.output()?.nativeElement.querySelector('video');
    if (!video || !video.videoWidth) {
      this.notice.set({ ok: false, text: "The MSME's video is not available. Start the assessment and wait for the MSME to join." });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0000ff';
    ctx.fillText(new Date().toLocaleString(), 10, 30);
    this.modalError.set('');
    this.capture.set({ target, targetId, image: canvas.toDataURL('image/jpeg', 0.9), name: defaultName, fixedName });
  }

  protected async saveCapture(): Promise<void> {
    const c = this.capture();
    if (!c) return;
    if (!c.name.trim()) {
      this.modalError.set('Please enter Photo Name.');
      return;
    }
    await this.run(
      this.api.savePhoto(this.zedId, this.certification, { target: c.target, targetId: c.targetId, name: c.fixedName ? null : c.name.trim(), image: c.image }),
      () => this.capture.set(null),
    );
  }

  protected async useTourPhoto(photo: RemotePhoto): Promise<void> {
    const requirementId = this.fromTourFor();
    if (requirementId === null) return;
    await this.run(
      this.api.savePhoto(this.zedId, this.certification, { target: 'Requirement', targetId: requirementId, fromPhotoId: photo.id }),
      () => this.fromTourFor.set(null),
    );
  }

  protected async removePhoto(photo: RemotePhoto): Promise<void> {
    if (!window.confirm('Remove this photo?')) return;
    await this.run(this.api.deletePhoto(this.zedId, this.certification, photo.id), () => undefined, false);
  }

  // ------------------------------------------------------------------ pop-ups

  protected openConformance(r: Row): void {
    this.modalError.set('');
    this.choice.set({ kind: 'conformance', id: this.id(r), title: 'Conformance', value: text(r, 'SaConformance'), remarks: text(r, 'SaAssessorRemarks'), max: 2000 });
  }

  protected openProduct(p: Row): void {
    this.modalError.set('');
    this.choice.set({ kind: 'product', id: this.id(p), title: text(p, 'ProductName'), value: text(p, 'IsSaVerified'), remarks: text(p, 'SaAssessorRemarks'), max: 1000 });
  }

  protected openSiteExterior(): void {
    this.modalError.set('');
    const m = this.msme();
    this.choice.set({ kind: 'siteExterior', id: null, title: 'Site Exterior Photos', value: text(m, 'IsSaVerified'), remarks: text(m, 'SaAssessorRemarks'), max: 1000 });
  }

  protected async saveChoice(): Promise<void> {
    const c = this.choice();
    if (!c) return;
    if (c.value !== 'Yes' && c.value !== 'No') {
      this.modalError.set('This is required.');
      return;
    }
    if (c.value === 'No' && !c.remarks.trim()) {
      this.modalError.set('Please enter remarks.');
      return;
    }
    const call =
      c.kind === 'conformance'
        ? this.api.conformance(this.zedId, this.certification, c.id!, c.value, c.remarks)
        : c.kind === 'product'
          ? this.api.validateProduct(this.zedId, this.certification, c.id!, c.value, c.remarks)
          : this.api.validateSiteExterior(this.zedId, this.certification, c.value, c.remarks);
    await this.run(call, () => this.choice.set(null));
  }

  protected openBasicInfo(row: (typeof BASIC_INFO)[number]): void {
    this.modalError.set('');
    this.textEdit.set({ kind: 'basicInfo', id: null, column: row.sa, title: row.label, value: text(this.msme(), row.sa), yesNo: row.yesNo });
  }

  protected openOfi(section: Row): void {
    this.modalError.set('');
    this.textEdit.set({ kind: 'ofi', id: this.id(section), column: '', title: 'OFI Comments', value: text(section, 'OfiComments'), yesNo: false });
  }

  protected openMeetingComments(meeting: Meeting): void {
    this.modalError.set('');
    this.textEdit.set({ kind: 'meeting', id: meeting.id, column: '', title: 'Meeting Comments', value: meeting.comments ?? '', yesNo: false });
  }

  protected async saveText(): Promise<void> {
    const e = this.textEdit();
    if (!e) return;
    if (!e.value.trim()) {
      this.modalError.set('This is required.');
      return;
    }
    const call =
      e.kind === 'basicInfo'
        ? this.api.basicInfo(this.zedId, this.certification, e.column, e.value)
        : e.kind === 'ofi'
          ? this.api.ofiComments(this.zedId, this.certification, e.id!, e.value)
          : this.api.meetingComments(this.zedId, this.certification, e.id!, e.value);
    await this.run(call, () => this.textEdit.set(null));
  }

  protected async addParticipant(meeting: Meeting, key: 'open' | 'close'): Promise<void> {
    const p = this.participant[key];
    if (!p.name.trim() || !p.designation.trim()) {
      this.notice.set({ ok: false, text: "Please enter the participant's name and designation." });
      return;
    }
    const ok = await this.run(this.api.addParticipant(this.zedId, this.certification, meeting.id, p.name.trim(), p.designation.trim()), () => undefined, false);
    if (ok) this.participant[key] = { name: '', designation: '' };
  }

  protected async openFinalSubmit(): Promise<void> {
    this.notice.set(null);
    this.busy.set(true);
    try {
      const check = await firstValueFrom(this.api.checkFinalSubmit(this.zedId, this.certification));
      if (!check.allowed) {
        this.notice.set({ ok: false, text: check.message ?? 'Please complete the assessment before final submit.' });
        return;
      }
      this.modalError.set('');
      this.finalSubmit.set({ check, comments: '', confirmed: false });
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const f = this.finalSubmit();
    if (!f || !f.confirmed) return;
    if (!f.comments.trim()) {
      this.modalError.set('Please enter comments.');
      return;
    }
    const ok = await this.run(this.api.finalSubmit(this.zedId, this.certification, f.comments.trim()), () => this.finalSubmit.set(null));
    if (ok) {
      this.leaveRoom();
      this.notice.set({ ok: true, text: 'Assessment submitted.' });
    }
  }
}
