/**
 * 2026-11-20 (incentive schemes, phase 2: onsite verification, docs/INCENTIVE-SCHEMES.md): the onsite assessor's scheme visits.
 * Home → "Scheme visits" (the applications the onsite agency allotted to the assessor) → a visit: start at the unit with a
 * selfie and a site photo (camera, GPS), the unit's representative, the applicant's answers read-only per section and item with
 * Valid / Not valid on the answers checked onsite, geo-tagged photos per item (the scheme's minimum to maximum), overall
 * remarks, then Recommend (verified claim) or Reject (reason and remarks) after a confirmation. Everything but the result is kept
 * on the phone and synced by the queue (offline works); the result needs a connection. All wording: Admin → Texts
 * (app.assessor.schemes.*).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isNetworkError, useFocusEffect, useNavigation, useRoute, useUi, zedDevice, type SyncJob, type Ui } from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { useInlineCapture, type InlinePhoto } from '../photo/capture';
import { formatDate, formatDateTime } from '../portfolio';
import { problemText, useSchemeTexts, type TextFields } from '../schemes/texts';
import {
  eligibleAmount,
  itemSlot,
  NOT_VALID,
  parseAmount,
  photosLeft,
  recommendProblems,
  rejectProblems,
  rupees,
  isValidMobile,
  VALID,
  VISITING,
  visitView,
  type SchemeDraft,
  type SchemeVisitAnswer,
  type SchemeVisitDetail,
  type SchemeVisitSummary,
  type ShownPhoto,
  type VisitView,
} from '../schemes/visits';
import { syncSchemeVisits } from '../sync/queue';
import { Badge, C, Card, Chip, DashedTile, EmptyState, Field, HeroHeader, LevelBadge, ListRow, Page, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll } from '../ui/zed';
import { ClearDataSheet, type ClearTarget } from './ClearDataSheet';
import { base64Uri, SubmitButton } from './MeetingScreens';

type T = (key: string, fields?: TextFields) => string;

const NAME_MAX = 200;
const REMARK_MAX = 1000;
const REMARKS_MAX = 4000;

/** The Clear data sheet of a scheme visit (its start, each item's photos, the checks and texts). */
export function schemeClearTarget(app: SaApp, t: T, v: { applicationId: number; unitName?: string | null; zedId?: string | null }): ClearTarget {
  const id = v.applicationId;
  return {
    name: v.unitName || v.zedId || String(id),
    badge: t('clear.badge'),
    load: () => app.schemes.dataSections(id),
    clear: ids => app.schemes.clearSections(id, ids),
    clearAll: () => app.schemes.clearAll(id),
    everythingLink: t('clear.everything'),
    everythingTitle: t('clear.everythingTitle'),
    everythingText: t('clear.everythingText'),
    confirmText: t('clear.confirmText'),
  };
}

/** Opens a document or photo of the application (downloaded with the sign-in token, as the reports). */
async function openFile(app: SaApp, ui: Ui, t: T, applicationId: number, name: string, isPdf: boolean) {
  if (!(await isNetworkAvailable())) return ui.toast(t('answers.openOffline'), { long: true });
  ui.showLoading();
  try {
    const url = app.schemeApi.schemeDocumentUrl(app.assessor?.assessorId ?? '', applicationId, name);
    const local = await zedDevice().downloadFile(url, name, app.schemeToken);
    if (isPdf) zedDevice().openPdf(local, name);
    else zedDevice().openImage(local);
  } catch {
    ui.toast(t('answers.openFailed'), { long: true });
  } finally {
    ui.hideLoading();
  }
}

// ------------------------------------------------------------------ Home entry

/** The Home card that leads to the scheme visits (with how many wait). */
export function SchemeVisitsHomeCard() {
  const app = useSa();
  const nav = useNavigation();
  const t = useSchemeTexts();
  const n = app.schemes.list.length;
  return (
    <Card style={{ paddingVertical: 4, marginBottom: 12 }} testID="scheme-visits-card">
      <ListRow
        icon="shield"
        title={t('home.quickAction')}
        subtitle={n ? t('home.card', { Count: n }) : t('list.subtitle')}
        badge={n ? <Badge label={String(n)} tone="primary" small testID="scheme-visits-count" /> : undefined}
        onPress={() => nav.push('SchemeVisits')}
        last
        testID="scheme-visits-open"
      />
    </Card>
  );
}

// ------------------------------------------------------------------ List

export function SchemeVisitsScreen() {
  const app = useSa();
  const nav = useNavigation();
  const t = useSchemeTexts();
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState<{ applicationId: number; unitName?: string | null; zedId?: string | null } | null>(null);

  const refresh = useCallback(async () => {
    if (!(await isNetworkAvailable())) return;
    try {
      await app.schemes.refreshList();
    } catch {
      // the kept list stays
    }
    syncSchemeVisits(app).catch(() => undefined);
  }, [app]);

  useFocusEffect(() => {
    refresh();
  });

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const list = app.schemes.list;
  const kept = app.schemes.kept;
  return (
    <Page testID="scheme-visits">
      <HeroHeader title={t('list.title')} subtitle={t('list.subtitle')} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}>
        {list.map(v => (
          <VisitCard key={v.applicationId} v={v} draft={app.schemes.draftOf(v.applicationId)} t={t} onOpen={() => nav.push('SchemeVisit', { applicationId: v.applicationId })} onClear={() => setClearing(v)} />
        ))}
        {list.length === 0 && kept.length === 0 ? (
          <EmptyState icon="shield" headline={t('list.emptyHeadline')} lines={[t('list.emptyText')]} testID="scheme-visits-empty" />
        ) : null}
        {kept.length ? (
          <>
            <SectionLabel label={t('list.kept')} />
            <Text style={[z.muted, { marginBottom: 10 }]}>{t('list.keptNote')}</Text>
            {kept.map(d => (
              <VisitCard key={d.applicationId} v={d.summary} draft={d} t={t} onClear={() => setClearing(d.summary)} />
            ))}
          </>
        ) : null}
      </ZScroll>
      {clearing ? <ClearDataSheet target={schemeClearTarget(app, t, clearing)} onClose={() => setClearing(null)} onCleared={() => app.touch()} /> : null}
    </Page>
  );
}

function VisitCard({ v, draft, t, onOpen, onClear }: { v: SchemeVisitSummary; draft: SchemeDraft | null; t: T; onOpen?: () => void; onClear: () => void }) {
  const app = useSa();
  const id = v.applicationId;
  const started = v.status === VISITING || !!draft?.selfie;
  const unsent = app.schemes.hasUnsent(id);
  return (
    <Card style={st.caseCard} testID={`scheme-visit-${id}`}>
      <View style={z.rowBetween}>
        <Text style={z.idText}>{v.zedId}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {unsent ? <Badge label={t('status.unsynced')} tone="warning" small testID={`scheme-unsent-${id}`} /> : null}
          {onOpen ? <Badge label={started ? t('status.visiting') : t('status.toVisit')} tone={started ? 'info' : 'primary'} small testID={`scheme-status-${id}`} /> : null}
        </View>
      </View>
      <Text style={[z.h2, { marginTop: 6 }]}>{v.unitName || v.zedId}</Text>
      <View style={[z.rowCenter, { marginTop: 6, flexWrap: 'wrap', gap: 8 }]}>
        {v.level ? <LevelBadge certification={v.level} name={v.levelName} small /> : null}
        <Text style={st.metaText}>{v.schemeName}</Text>
      </View>
      {v.address ? (
        <View style={[z.rowCenter, st.meta]}>
          <ZIcon name="map-pin" size={14} color={C.tSecondary} />
          <Text style={[st.metaText, { marginLeft: 6, flex: 1 }]}>{v.address}</Text>
        </View>
      ) : null}
      <View style={[z.rowBetween, st.meta]}>
        <View style={z.rowCenter}>
          <ZIcon name="calendar" size={14} color={C.tSecondary} />
          <Text style={[st.metaText, { marginLeft: 6 }]}>
            {v.visitStartedOn ? t('list.started', { Date: formatDate(v.visitStartedOn) }) : v.allottedOn ? t('list.allotted', { Date: formatDate(v.allottedOn) }) : ''}
          </Text>
        </View>
        {v.claimAmount != null ? <Text style={st.metaStrong}>{t('list.claim', { Amount: rupees(v.claimAmount) })}</Text> : null}
      </View>
      <View style={st.cardActions}>
        {onOpen ? <ZButton title={t('list.open')} icon="arrow-right" small onPress={onOpen} style={{ minWidth: 110 }} testID={`scheme-open-${id}`} /> : <View />}
        {draft ? <ZButton title={t('list.clear')} icon="close" variant="dangerOutline" small onPress={onClear} style={{ minWidth: 136 }} testID={`scheme-clear-${id}`} /> : null}
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ Visit

export function SchemeVisitScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const t = useSchemeTexts();
  const { params } = useRoute<{ applicationId: number }>();
  const id = Number(params.applicationId);
  const { capture } = useInlineCapture();

  const [detail, setDetail] = useState<SchemeVisitDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selfie, setSelfie] = useState<InlinePhoto | null>(null);
  const [site, setSite] = useState<InlinePhoto | null>(null);
  const [repName, setRepName] = useState<string | null>(null);
  const [repMobile, setRepMobile] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<string | null>(null);
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<'recommend' | 'reject' | null>(null);
  const [claimText, setClaimText] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const isOnline = await isNetworkAvailable();
    setOnline(isOnline);
    let res;
    try {
      res = await app.schemes.detail(id, isOnline);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      setOnline(false);
      res = { detail: await app.schemes.keptDetail(id), fromServer: false };
    }
    setLoaded(true);
    if (res.detail) setDetail(res.detail);
    if (res.error) ui.toast(res.error, { long: true });
  }, [app, id, ui]);

  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);

  const draft = app.schemes.draftOf(id);
  const view = useMemo(() => (detail ? visitView(detail, draft) : null), [detail, draft]);

  // The sends waiting for this visit (the strip), kept in step with the queue.
  useEffect(() => {
    let alive = true;
    const read = () => app.schemes.pending(id).then(list => alive && setJobs(list)).catch(() => undefined);
    read();
    const off = app.queue.subscribe(read);
    return () => {
      alive = false;
      off();
    };
  }, [app, id]);

  // Thumbnails of the photos kept on the phone.
  const localIds = [draft?.selfie?.photoId, draft?.site?.photoId, ...(draft?.photos ?? []).map(p => p.photoId)].filter((x): x is string => !!x);
  const localKey = localIds.join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const pid of localIds) {
        const b = await app.schemes.image(pid);
        if (b) out[pid] = b;
      }
      if (alive) setThumbs(out);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, localKey]);

  if (!loaded) return <Page testID="scheme-visit"><HeroHeader title={t('visit.title')} onBack={() => nav.pop()} /></Page>;
  if (!detail || !view) {
    return (
      <Page testID="scheme-visit">
        <HeroHeader title={t('visit.title')} onBack={() => nav.pop()} />
        <View style={z.screenPad}>
          <EmptyState icon="info" headline={t('visit.title')} lines={[t('visit.notAvailable')]} testID="scheme-visit-unavailable" />
        </View>
      </Page>
    );
  }

  const open = view.open;
  const name = repName ?? view.representativeName;
  const mobile = repMobile ?? view.representativeMobile;
  const allRemarks = remarks ?? view.remarks;
  const claim = parseAmount(claimText);
  const problems = decision === 'reject' ? rejectProblems({ ...view, remarks: allRemarks }, reason) : recommendProblems({ ...view, representativeName: name, representativeMobile: mobile }, claim);
  const sync = () => syncSchemeVisits(app).catch(() => undefined);

  // ----- actions

  const take = async (which: 'selfie' | 'site') => {
    const shot = await capture({ front: which === 'selfie' });
    if (!shot) return;
    if (which === 'selfie') setSelfie(shot);
    else setSite(shot);
  };

  const start = async () => {
    if (!selfie || !site) return ui.toast(t('start.needBoth'));
    await app.schemes.startVisit(detail, selfie, site);
    setSelfie(null);
    setSite(null);
    if (!(await isNetworkAvailable())) ui.toast(t('start.queued'), { long: true });
    sync();
  };

  const saveRepresentative = async () => {
    if (name === view.representativeName && mobile === view.representativeMobile) return;
    await app.schemes.setRepresentative(detail, name.trim(), mobile.trim());
    setRepName(null);
    setRepMobile(null);
    sync();
  };

  const saveRemarks = async () => {
    if (allRemarks === view.remarks) return;
    await app.schemes.setRemarks(detail, allRemarks);
    setRemarks(null);
    sync();
  };

  const check = async (path: string, status: typeof VALID | typeof NOT_VALID) => {
    await app.schemes.setCheck(detail, path, status, status === NOT_VALID ? (remarkDrafts[path] ?? view.checks[path]?.remarks ?? '') : null);
    sync();
  };

  const saveRemark = async (path: string) => {
    const text = remarkDrafts[path];
    if (text === undefined || text === (view.checks[path]?.remarks ?? '')) return;
    await app.schemes.setCheck(detail, path, NOT_VALID, text.trim());
    setRemarkDrafts(r => {
      const rest = { ...r };
      delete rest[path];
      return rest;
    });
    sync();
  };

  const addPhoto = async (section: string, index: number) => {
    if (photosLeft(view, itemSlot(section, index)) <= 0) return ui.toast(t('photos.max', { Max: detail.photosMax }));
    const shot = await capture();
    if (!shot) return;
    await app.schemes.addPhoto(detail, section, index, shot);
    sync();
  };

  const removePhoto = (slot: string, photo: ShownPhoto) =>
    ui.alert(t('photos.removeTitle'), null, [
      { text: t('confirm.cancel'), style: 'cancel' },
      {
        text: t('photos.remove'),
        style: 'destructive',
        onPress: () => {
          app.schemes
            .removePhoto(detail, slot, photo)
            .then(sync)
            .catch(() => undefined);
        },
      },
    ]);

  const retry = async () => {
    for (const j of jobs) if (j.status === 'failed') await app.queue.retry(j.key);
    syncSchemeVisits(app, true).catch(() => undefined);
  };

  const submit = async () => {
    if (!decision) return;
    if (problems.length) return ui.toast(problemText(t, problems[0]!), { long: true });
    if (!(await isNetworkAvailable())) return ui.showAlert(t('submit.offline'));
    // What was typed and not yet saved (the field still focused) goes with the result.
    if (name !== view.representativeName || mobile !== view.representativeMobile) await saveRepresentative();
    if (allRemarks !== view.remarks) await saveRemarks();
    ui.showLoading();
    let r: { ok: boolean; message: string };
    try {
      r = await app.schemes.submit(detail, {
        decision,
        verifiedClaim: decision === 'recommend' ? claim : null,
        reason: decision === 'reject' ? reason.trim() : null,
        remarks: allRemarks.trim() || null,
      });
    } catch (e) {
      ui.hideLoading();
      return ui.showAlert(isNetworkError(e) ? t('submit.offline') : t('visit.notAvailable'));
    }
    ui.hideLoading();
    if (r.ok) ui.alert(null, r.message, [{ text: 'OK', onPress: () => nav.pop() }], false);
    else ui.showAlert(r.message);
  };

  const confirm = () => {
    if (!decision) return;
    if (problems.length) return ui.toast(problemText(t, problems[0]!), { long: true });
    const recommend = decision === 'recommend';
    ui.alert(
      recommend ? t('confirm.recommendTitle') : t('confirm.rejectTitle'),
      recommend ? t('confirm.recommendText', { Claim: rupees(claim), Amount: rupees(eligibleAmount(claim ?? 0, detail.sharePercent, detail.maxAmount)) }) : t('confirm.rejectText'),
      [
        { text: t('confirm.cancel'), style: 'cancel' },
        { text: t('confirm.submit'), style: recommend ? 'default' : 'destructive', onPress: () => void submit() },
      ],
    );
  };

  // ----- layout

  const failed = jobs.find(j => j.status === 'failed');
  const sections = groupSlots(detail);

  return (
    <Page testID="scheme-visit">
      <HeroHeader title={t('visit.title')} subtitle={detail.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        {!online ? <Strip text={t('visit.offline')} tone="info" /> : null}
        {failed ? (
          <View style={st.syncRow} testID="scheme-sync-failed">
            <View style={{ flex: 1 }}>
              <Strip text={t('visit.syncFailed', { Error: failed.lastError ?? '' })} tone="danger" />
            </View>
            <ZButton title={t('visit.retry')} small variant="outline" onPress={retry} style={{ marginLeft: 8 }} testID="scheme-sync-retry" />
          </View>
        ) : jobs.length ? (
          <Strip text={t('visit.unsynced', { Count: jobs.length })} tone="warning" />
        ) : null}
        {!open ? <Strip text={t('visit.readOnly')} tone="success" icon="check" /> : null}

        <Card testID="scheme-unit">
          <Text style={z.h2}>{detail.unitName || detail.zedId}</Text>
          <View style={[z.rowCenter, { marginTop: 6, flexWrap: 'wrap', gap: 8 }]}>
            {detail.level ? <LevelBadge certification={detail.level} name={detail.levelName} small /> : null}
            <Text style={st.metaText}>{detail.schemeName}</Text>
          </View>
          {detail.address ? (
            <View style={[z.rowCenter, st.meta]}>
              <ZIcon name="map-pin" size={14} color={C.tSecondary} />
              <Text style={[st.metaText, { marginLeft: 6, flex: 1 }]}>{detail.address}</Text>
            </View>
          ) : null}
          <Text style={[st.metaStrong, { marginTop: 8 }]}>{t('visit.claimed', { Claim: rupees(detail.claimAmount), Eligible: rupees(detail.eligibleAmount) })}</Text>
        </Card>

        {/* Start of the visit */}
        {!view.started ? (
          open ? (
            <View testID="scheme-start">
              <SectionLabel label={t('start.heading')} />
              <Text style={[z.sub, { marginBottom: 10 }]}>{t('start.note')}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <StartTile label={t('start.selfie')} shot={selfie} t={t} onPress={() => take('selfie')} testID="scheme-selfie" />
                <StartTile label={t('start.site')} shot={site} t={t} onPress={() => take('site')} testID="scheme-site" />
              </View>
              <SubmitButton title={t('start.button')} ready={!!selfie && !!site} onPress={start} style={{ marginTop: 14 }} testID="scheme-start-visit" />
            </View>
          ) : null
        ) : (
          <View testID="scheme-started">
            <Strip text={t('start.done', { Date: formatDateTime(view.startedOn) })} tone="success" icon="check" />
            {view.startPending ? <Strip text={t('start.queued')} tone="warning" /> : null}
          </View>
        )}

        {view.started ? (
          <>
            <SectionLabel label={t('rep.heading')} />
            <Card>
              <Field
                label={t('rep.name')}
                value={name}
                onChangeText={setRepName}
                onBlur={saveRepresentative}
                maxLength={NAME_MAX}
                editable={open}
                icon="user"
                testID="scheme-rep-name"
              />
              <Field
                label={t('rep.mobile')}
                value={mobile}
                onChangeText={s => setRepMobile(s.replace(/[^0-9]/g, ''))}
                onBlur={saveRepresentative}
                keyboardType="number-pad"
                maxLength={10}
                editable={open}
                icon="phone"
                error={mobile.length > 0 && !isValidMobile(mobile) && (mobile.length === 10 || repMobile === null) ? t('rep.mobileInvalid') : null}
                style={{ marginBottom: 0 }}
                testID="scheme-rep-mobile"
              />
            </Card>
          </>
        ) : null}

        <SectionLabel
          label={t('answers.heading')}
          right={detail.places.length ? <Text style={z.muted}>{t('answers.checked', { Done: detail.places.filter(p => !!view.checks[p.path]?.status).length, Total: detail.places.length })}</Text> : undefined}
        />
        {sections.map(sec => (
          <View key={sec.key}>
            {sec.repeating ? <Text style={st.sectionTitle}>{sec.title}</Text> : null}
            {sec.slots.map(slot => {
              const key = itemSlot(slot.section, slot.index);
              const shown = view.photos[key] ?? [];
              return (
                <Card key={key} style={{ marginBottom: 12 }} testID={`scheme-item-${key}`}>
                  <Text style={z.title}>{slot.title}</Text>
                  {slot.answers.map(a => (
                    <AnswerRow
                      key={a.path}
                      a={a}
                      view={view}
                      t={t}
                      open={open && view.started}
                      remark={remarkDrafts[a.path] ?? view.checks[a.path]?.remarks ?? ''}
                      onRemark={text => setRemarkDrafts(r => ({ ...r, [a.path]: text }))}
                      onRemarkDone={() => saveRemark(a.path)}
                      onCheck={status => check(a.path, status)}
                      onOpenFile={f => openFile(app, ui, t, id, f.name, f.isPdf)}
                    />
                  ))}
                  <View style={st.photosHead}>
                    <Text style={st.label}>{t('photos.heading')}</Text>
                    <Text style={z.muted}>{t('photos.count', { Taken: shown.length, Min: detail.photosMin, Max: detail.photosMax })}</Text>
                  </View>
                  <View style={st.photos}>
                    {shown.map(p => (
                      <PhotoThumb
                        key={p.key}
                        p={p}
                        uri={p.photoId && thumbs[p.photoId] ? base64Uri(thumbs[p.photoId]!) : null}
                        t={t}
                        onOpen={!p.local && p.name ? () => openFile(app, ui, t, id, p.name!, false) : undefined}
                        onRemove={open && view.started ? () => removePhoto(key, p) : undefined}
                      />
                    ))}
                    {open && view.started && photosLeft(view, key) > 0 ? (
                      <DashedTile label={t('photos.take')} size={72} onPress={() => addPhoto(slot.section, slot.index)} testID={`scheme-take-${key}`} />
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        ))}

        {view.started ? (
          <>
            <SectionLabel label={t('remarks.heading')} />
            <Field
              value={allRemarks}
              onChangeText={setRemarks}
              onBlur={saveRemarks}
              multiline
              maxLength={REMARKS_MAX}
              editable={open}
              placeholder={t('remarks.placeholder')}
              testID="scheme-remarks"
            />
          </>
        ) : null}

        {open && view.started ? (
          <View testID="scheme-decision">
            <SectionLabel label={t('decision.heading')} />
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <Chip label={t('decision.recommend')} active={decision === 'recommend'} onPress={() => setDecision('recommend')} testID="scheme-decision-recommend" />
              <Chip label={t('decision.reject')} active={decision === 'reject'} onPress={() => setDecision('reject')} testID="scheme-decision-reject" />
            </View>
            {decision === 'recommend' ? (
              <Card>
                <Field label={t('decision.verifiedClaim')} value={claimText} onChangeText={setClaimText} keyboardType="decimal-pad" maxLength={13} testID="scheme-claim" />
                <Text style={z.muted}>{t('decision.grade', { Share: detail.sharePercent ?? 0, Max: rupees(detail.maxAmount) })}</Text>
                <Text style={[st.metaStrong, { marginTop: 4 }]} testID="scheme-eligible">
                  {t('decision.eligible', { Amount: rupees(eligibleAmount(claim ?? 0, detail.sharePercent, detail.maxAmount)) })}
                </Text>
              </Card>
            ) : null}
            {decision === 'reject' ? (
              <Field label={t('decision.reason')} value={reason} onChangeText={setReason} multiline maxLength={REMARK_MAX} testID="scheme-reason" />
            ) : null}
            {decision && problems.length ? (
              <View style={st.problems} testID="scheme-problems">
                <Text style={st.label}>{t('decision.missing')}</Text>
                {problems.map(p => (
                  <Text key={p.code + JSON.stringify(p.fields ?? {})} style={st.problem}>{`• ${problemText(t, p)}`}</Text>
                ))}
              </View>
            ) : null}
            {decision ? <SubmitButton title={t('decision.submit')} ready={problems.length === 0} onPress={confirm} style={{ marginTop: 12 }} testID="scheme-submit" /> : null}
          </View>
        ) : null}
      </ZScroll>
    </Page>
  );
}

/** The detail's photo items grouped by section, each with its answers (a plain section's single item too). */
function groupSlots(d: SchemeVisitDetail) {
  const out: Array<{ key: string; title: string; repeating: boolean; slots: Array<{ section: string; index: number; title: string; answers: SchemeVisitAnswer[] }> }> = [];
  for (const slot of d.items) {
    const sec = d.sections.find(s => s.key === slot.section);
    let group = out.find(g => g.key === slot.section);
    if (!group) {
      group = { key: slot.section, title: sec?.title ?? slot.title, repeating: !!sec?.repeating, slots: [] };
      out.push(group);
    }
    group.slots.push({ section: slot.section, index: slot.index, title: slot.title, answers: sec?.items.find(i => i.index === slot.index)?.answers ?? [] });
  }
  return out;
}

function StartTile({ label, shot, t, onPress, testID }: { label: string; shot: InlinePhoto | null; t: T; onPress: () => void; testID: string }) {
  return (
    <Pressable style={st.startTile} onPress={onPress} accessibilityRole="button" testID={testID}>
      {shot ? (
        <Image source={{ uri: base64Uri(shot.base64) }} style={st.startImage} resizeMode="cover" testID={`${testID}-image`} />
      ) : (
        <View style={[st.startImage, st.startEmpty]}>
          <ZIcon name="camera" size={26} color={C.tMuted} />
        </View>
      )}
      <Text style={[z.title, { marginTop: 8 }]}>{label}</Text>
      {shot?.coords ? <Text style={z.muted} numberOfLines={1}>{`${shot.coords.latitude}, ${shot.coords.longitude}`}</Text> : null}
      <Text style={st.pill}>{shot ? t('start.retake') : t('start.capture')}</Text>
    </Pressable>
  );
}

function PhotoThumb({ p, uri, t, onOpen, onRemove }: { p: ShownPhoto; uri: string | null; t: T; onOpen?: () => void; onRemove?: () => void }) {
  return (
    <View style={st.thumbBox} testID={`scheme-photo-${p.key}`}>
      <Pressable onPress={onOpen} disabled={!onOpen} style={st.thumb}>
        {uri ? (
          <Image source={{ uri }} style={st.thumbImage} resizeMode="cover" />
        ) : (
          <View style={[st.thumbImage, st.startEmpty]}>
            <ZIcon name="image" size={20} color={C.tMuted} />
            {!p.local ? <Text style={st.thumbText}>{t('photos.onServer')}</Text> : null}
          </View>
        )}
      </Pressable>
      {!p.uploaded ? (
        <View style={st.thumbPending}>
          <ZIcon name="sync" size={11} color={C.tInverse} />
        </View>
      ) : null}
      {onRemove ? (
        <Pressable style={st.thumbRemove} onPress={onRemove} hitSlop={8} accessibilityLabel={t('photos.remove')} testID={`scheme-remove-${p.key}`}>
          <ZIcon name="close" size={11} color={C.tInverse} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AnswerRow({
  a,
  view,
  t,
  open,
  remark,
  onRemark,
  onRemarkDone,
  onCheck,
  onOpenFile,
}: {
  a: SchemeVisitAnswer;
  view: VisitView;
  t: T;
  open: boolean;
  remark: string;
  onRemark: (text: string) => void;
  onRemarkDone: () => void;
  onCheck: (status: typeof VALID | typeof NOT_VALID) => void;
  onOpenFile: (f: { name: string; isPdf: boolean }) => void;
}) {
  const status = view.checks[a.path]?.status ?? null;
  return (
    <View style={st.answer} testID={`scheme-answer-${a.path}`}>
      <Text style={st.label}>{a.label}</Text>
      {a.files?.length ? (
        a.files.map(f => (
          <Pressable key={f.name} style={st.file} onPress={() => onOpenFile(f)} testID={`scheme-file-${f.name}`}>
            <ZIcon name={f.isPdf ? 'document' : 'image'} size={16} color={C.primaryText} />
            <Text style={st.fileText} numberOfLines={1}>{`${t('answers.open')} · ${f.name}`}</Text>
          </Pressable>
        ))
      ) : (
        <Text style={z.body}>{a.isClaim && a.value ? `Rs. ${rupees(Number(a.value))}` : a.value || '—'}</Text>
      )}
      {a.desktop?.status ? (
        <Text style={z.muted}>{t('answers.desktop', { Status: a.desktop.status === VALID ? t('answers.valid') : t('answers.notValid') })}</Text>
      ) : null}
      {a.checkOnsite ? (
        <>
          <View style={st.checkRow}>
            {([VALID, NOT_VALID] as const).map(s => {
              const on = status === s;
              const tone = s === VALID ? { fg: C.success, bg: C.successBg } : { fg: C.danger, bg: C.dangerBg };
              return (
                <Pressable
                  key={s}
                  style={[st.choice, { borderColor: on ? tone.fg : C.border, borderWidth: on ? 2 : 1, backgroundColor: on ? tone.bg : C.surface }]}
                  onPress={open ? () => onCheck(s) : undefined}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: !open }}
                  testID={`scheme-check-${a.path}-${s === VALID ? 'valid' : 'notvalid'}`}
                >
                  <Text style={{ color: on ? tone.fg : C.tPrimary, fontWeight: on ? '700' : '500', fontSize: 13 }}>{s === VALID ? t('answers.valid') : t('answers.notValid')}</Text>
                </Pressable>
              );
            })}
          </View>
          {status === NOT_VALID ? (
            <Field
              label={t('answers.remark')}
              value={remark}
              onChangeText={onRemark}
              onBlur={onRemarkDone}
              multiline
              maxLength={REMARK_MAX}
              editable={open}
              error={!remark.trim() ? t('ready.remark') : null}
              style={{ marginTop: 8, marginBottom: 0 }}
              testID={`scheme-remark-${a.path}`}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  caseCard: { borderLeftWidth: 4, borderLeftColor: C.primary },
  meta: { marginTop: 8 },
  metaText: { fontSize: 13, color: C.tSecondary },
  metaStrong: { fontSize: 13, color: C.tPrimary, fontWeight: '700' },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', borderTopColor: C.divider, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  syncRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.tSecondary, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  answer: { borderTopColor: C.divider, borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  file: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  fileText: { marginLeft: 6, color: C.primaryText, fontWeight: '600', fontSize: 13, flex: 1 },
  checkRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  choice: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  photosHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopColor: C.divider, borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  thumbBox: { width: 72, height: 72 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  thumbImage: { width: 72, height: 72, borderRadius: 10 },
  thumbText: { fontSize: 9, color: C.tMuted, marginTop: 2, textAlign: 'center' },
  thumbPending: { position: 'absolute', left: 4, bottom: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.warning, alignItems: 'center', justifyContent: 'center' },
  thumbRemove: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center' },
  startTile: { flex: 1, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  startImage: { width: '100%', height: 120, borderRadius: 10 },
  startEmpty: { backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: C.tMuted },
  pill: { marginTop: 8, color: C.primaryText, fontWeight: '700', fontSize: 13 },
  problems: { backgroundColor: C.warningBg, borderRadius: 12, padding: 12, marginTop: 4 },
  problem: { fontSize: 13, color: C.tPrimary, marginTop: 2 },
});
