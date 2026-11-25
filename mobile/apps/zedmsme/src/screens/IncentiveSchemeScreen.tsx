/**
 * New (2026-11-25, the product owner: the Admin's incentive schemes in the app with the full forms, not a link to the web): one
 * scheme of Admin → Incentive Schemes, as the web page (frontend msme/incentive-schemes/incentive-scheme.*), on the portal's
 * Msme/AppIncentiveSchemes endpoints (the same rules as the web, the app sign-in token). The form's steps: the standard blocks the
 * scheme has on (disclaimer, instructions, unit confirmation), the sections (a plain section as one form; an "Add more" section as
 * its saved items and the item being edited), the bank account, then the review with the declaration and the submission. After
 * submission: the status and the history; during a correction round only the answers found not valid are edited, with the
 * assessor's remarks ("Submit corrections" by the due date); after a rejection, the reason and "Apply again". Documents come from
 * the camera, the gallery or a PDF (the app's capture) and are uploaded at once. Every wording is an Admin text.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBox,
  CheckBoxGroup,
  colors,
  dimens,
  errorOf,
  FieldLabel,
  HtmlText,
  isNetworkError,
  isSuccess,
  OutlinedButton,
  OutlinedInput,
  RadioButton,
  removePhoto,
  ScreenFrame,
  SelectionPicker,
  shapes,
  textStyles,
  useAppText,
  useBackHandler,
  useFocusEffect,
  useNavigation,
  useRoute,
  useUi,
  ZedButton,
  zedDevice,
  type PhotoSource,
} from '@zed/shared';
import type { SchemePageResponse } from '../api';
import { useMsme } from '../app/context';
import { useScreenCapture } from '../components/capture';
import {
  ACCOUNT_FIELD,
  BANK_SECTION,
  CHEQUE_FIELD,
  claimOf,
  dateBound,
  displayDate,
  eligibleOf,
  filesOf,
  holdText,
  inr,
  lockedNote,
  statusLabel,
  useSchemeTexts,
  type FormAnswers,
  type FormField,
  type FormItem,
  type FormSection,
  type PickEntry,
  type SchemeAccount,
  type SchemePage,
  type SchemeT,
} from '../incentiveSchemes';
import { Footer } from '../ui/legacy';

type StepKind = 'disclaimer' | 'instructions' | 'unit' | 'section' | 'bank' | 'summary';
type Step = { kind: StepKind; label: string; section?: FormSection };
/** An item being edited: a plain section (index 0) or an "Add more" item (index = count: a new one). */
type Editor = { section: string; index: number; pick: string | null; values: Record<string, string | null> };
type Mode = 'form' | 'status' | 'correction' | 'rejected' | 'closed';

const EMPTY_ACCOUNT: SchemeAccount = { accountNo: '', confirmAccountNo: '', ifscCode: '', branchAddress: '', bankName: '' };

/** What the page shows: the form, the submitted application, a correction round, a rejection, or why it cannot be applied for. */
export function modeOf(p: SchemePage | null): Mode {
  const a = p?.application;
  if (!p) return 'closed';
  if (!a || a.status === 'Draft') return p.canApply ? 'form' : 'closed';
  if (a.status === 'Correction') return 'correction';
  if (a.status === 'Rejected') return 'rejected';
  return 'status';
}

/** The steps of the form: the standard blocks the scheme has on, the sections, the bank account, the review. */
export function stepsOf(p: SchemePage | null, t: SchemeT): Step[] {
  const s = p?.scheme;
  if (!s) return [];
  const out: Step[] = [];
  if (s.blocks.disclaimer) out.push({ kind: 'disclaimer', label: t('step.disclaimer') });
  if (s.blocks.instructions) out.push({ kind: 'instructions', label: t('step.instructions') });
  out.push({ kind: 'unit', label: t('step.unit') });
  for (const section of s.sections) out.push({ kind: 'section', label: section.title, section });
  if (s.blocks.bankAccount) out.push({ kind: 'bank', label: t('step.bank') });
  out.push({ kind: 'summary', label: t('step.summary') });
  return out;
}

/** The saved items of a section ("Add more": the saved ones; a plain section: its one item). */
const itemsOf = (p: SchemePage | null, s: FormSection): FormItem[] =>
  (p?.application?.answers.sections[s.key] ?? []).filter(i => i.saved || !s.repeating);

export function IncentiveSchemeScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const t = useSchemeTexts();
  const { code } = useRoute<{ code: string }>().params;
  const zedId = app.user?.MsmeDetails?.ZedId ?? app.loginId ?? '';

  const [page, setPage] = useState<SchemePage | null>(null);
  const pageRef = useRef<SchemePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [consent, setConsent] = useState(false);
  const [unitConfirmed, setUnitConfirmed] = useState(false);
  const [declaration, setDeclaration] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [cheque, setCheque] = useState<string[]>([]);
  const [account, setAccount] = useState<SchemeAccount>(EMPTY_ACCOUNT);
  /** Correction round: the items being corrected ("section/index" → values). */
  const [fixes, setFixes] = useState<Record<string, Editor>>({});

  const scheme = page?.scheme ?? null;
  const application = page?.application ?? null;
  const mode = modeOf(page);
  const steps = stepsOf(page, t);
  const step = steps[stepIndex] ?? null;
  const title = scheme?.card.title || scheme?.name || '';
  const fail = (message: string) => ui.showAlert(message);

  /** A new answer of the portal: the page, and the local copies of the bank block and the correction items. */
  const apply = useCallback((p: SchemePage) => {
    pageRef.current = p;
    setPage(p);
    const a = p.application;
    const bank = a?.answers.sections[BANK_SECTION]?.[0];
    if (bank) setCheque(filesOf(bank.values[CHEQUE_FIELD]));
    if (a?.account) {
      setAccount(old =>
        old.accountNo
          ? old
          : {
              accountNo: a.account!.accountNo ?? '',
              confirmAccountNo: a.account!.accountNo ?? '',
              ifscCode: a.account!.ifscCode ?? '',
              branchAddress: a.account!.branchAddress ?? '',
              bankName: a.account!.bankName ?? '',
            },
      );
    }
    if (a?.status === 'Correction') {
      const next: Record<string, Editor> = {};
      for (const key of flaggedItems(p)) {
        const [section, index] = key.split('/');
        const item = a.answers.sections[section!]?.[Number(index)];
        if (item) next[key] = { section: section!, index: Number(index), pick: item.pick ?? null, values: { ...item.values } };
      }
      setFixes(next);
    }
  }, []);

  /** One call of the portal with the waiting overlay: the new page, or null after showing why. */
  const call = useCallback(
    async (work: () => Promise<SchemePageResponse>): Promise<SchemePage | null> => {
      ui.showLoading();
      try {
        const r = await work();
        if (!isSuccess(r) || !r.page) {
          ui.showAlert(r?.errorMessage?.trim() || errorOf(r));
          return null;
        }
        apply(r.page);
        return r.page;
      } catch (e) {
        ui.showAlert(isNetworkError(e) ? t('error.offline') : t('error.failed'));
        return null;
      } finally {
        ui.hideLoading();
      }
    },
    [apply, t, ui],
  );

  const load = useCallback(async () => {
    setError(null);
    ui.showLoading();
    try {
      const r = await app.api.getIncentiveScheme(code);
      if (!isSuccess(r) || !r.page) throw new Error(r?.errorMessage?.trim() || t('error.load'));
      apply(r.page);
    } catch (e) {
      setError(isNetworkError(e) ? t('error.offline') : e instanceof Error && e.message.trim() ? e.message : t('error.load'));
    } finally {
      ui.hideLoading();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, code]);

  useFocusEffect(
    useCallback(() => {
      if (!pageRef.current) void load();
    }, [load]),
  );

  useBackHandler(() => {
    if (ui.isLoading) return true;
    if (mode === 'form' && stepIndex > 0) {
      void go(stepIndex - 1);
      return true;
    }
    return false;
  });

  // ----- steps -----

  const openPlain = (p: SchemePage | null, s: FormSection) => {
    const item = p?.application?.answers.sections[s.key]?.[0];
    setEditor({ section: s.key, index: 0, pick: null, values: { ...(item?.values ?? {}) } });
  };

  const openItem = (s: FormSection, index: number) => {
    const item = pageRef.current?.application?.answers.sections[s.key]?.[index];
    setEditor({ section: s.key, index, pick: item?.pick ?? null, values: { ...(item?.values ?? {}) } });
  };

  const go = async (index: number) => {
    const target = steps[index];
    if (!target) return;
    let p = pageRef.current;
    if ((target.kind === 'section' || target.kind === 'bank') && !p?.application) {
      p = await call(() => app.api.startSchemeDraft(code));
      if (!p) return;
    }
    setEditor(null);
    if (target.kind === 'section' && target.section && !target.section.repeating) openPlain(p, target.section);
    if (target.kind === 'section' && target.section?.repeating && !itemsOf(p, target.section).length) {
      setEditor({ section: target.section.key, index: 0, pick: null, values: {} });
    }
    setStepIndex(index);
  };

  /** Saves the item being edited (a plain section or an "Add more" item); true when saved. */
  const saveEditor = async (): Promise<boolean> => {
    const e = editor;
    const s = scheme?.sections.find(x => x.key === e?.section);
    if (!e || !s) return false;
    if (s.pick && !e.pick) {
      fail(t('error.pick', { Label: s.pick.label || t('items.pickFallback') }));
      return false;
    }
    const missing = s.fields.find(f => f.required && f.type !== 'copy' && !e.values[f.key]);
    if (missing) {
      fail(t('error.required', { Label: missing.label }));
      return false;
    }
    const p = await call(() =>
      s.repeating ? app.api.saveSchemeItem(code, s.key, e.index, e.pick, e.values) : app.api.saveSchemeSection(code, s.key, e.values),
    );
    if (!p) return false;
    if (s.repeating) setEditor(null);
    return true;
  };

  const bankValid = (): boolean => {
    const a = account;
    if (![a.accountNo, a.confirmAccountNo, a.ifscCode, a.branchAddress, a.bankName].every(v => v.trim())) return (fail(t('error.bankRequired')), false);
    if (!/^[0-9]{9,18}$/.test(a.accountNo.trim())) return (fail(t('error.accountNo')), false);
    if (a.accountNo.trim() !== a.confirmAccountNo.trim()) return (fail(t('error.accountMismatch')), false);
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(a.ifscCode.trim())) return (fail(t('error.ifsc')), false);
    if (!cheque.length) return (fail(t('error.cheque')), false);
    return true;
  };

  const sentAccount = () => ({ ...account, ifscCode: account.ifscCode.trim().toUpperCase() });

  const submit = async () => {
    const blocks = scheme!.blocks;
    if (blocks.declaration && !declaration) return fail(t('error.declaration'));
    const p = await call(() =>
      app.api.submitScheme(code, {
        account: blocks.bankAccount ? sentAccount() : null,
        cheque,
        unitConfirmed: unitConfirmed || !blocks.unitConfirm,
        declaration: declaration || !blocks.declaration,
      }),
    );
    if (p) {
      ui.toast(t('application.submitted'), { long: true });
      void app.refreshIncentiveSchemes();
    }
  };

  /** "Proceed" of the current step: its own check (or save), then the next step; the review submits. */
  const next = async () => {
    const s = step;
    if (!s || !scheme) return;
    if (s.kind === 'disclaimer' && !consent) return fail(t('error.consent'));
    if (s.kind === 'unit' && scheme.blocks.unitConfirm && !unitConfirmed) return fail(t('error.unit'));
    if (s.kind === 'section' && s.section) {
      if (!s.section.repeating) {
        if (!(await saveEditor())) return;
      } else {
        if (editor) return fail(t('error.unsaved'));
        if (itemsOf(pageRef.current, s.section).length < s.section.minItems) return fail(t('error.minItems', { Count: s.section.minItems }));
      }
    }
    if (s.kind === 'bank' && !bankValid()) return;
    if (s.kind === 'summary') return submit();
    await go(stepIndex + 1);
  };

  const removeItem = async (s: FormSection, index: number) => {
    if (await call(() => app.api.removeSchemeItem(code, s.key, index))) setEditor(null);
  };

  /** "Apply again" after a rejection: a new draft, then the form from its first step. */
  const applyAgain = async () => {
    if (!(await call(() => app.api.startSchemeDraft(code)))) return;
    setConsent(false);
    setUnitConfirmed(false);
    setDeclaration(false);
    setEditor(null);
    setStepIndex(0);
  };

  // ----- correction round -----

  const flagged = new Set((application?.checks ?? []).map(c => c.path));
  const bankFlagged = flagged.has(`${BANK_SECTION}/0/${ACCOUNT_FIELD}`);
  const chequeFlagged = flagged.has(`${BANK_SECTION}/0/${CHEQUE_FIELD}`);
  const remark = (path: string): string | null => {
    const c = application?.checks.find(x => x.path === path);
    return c ? c.remarks ?? '' : null;
  };

  const saveFix = async (key: string) => {
    const e = fixes[key];
    const s = scheme?.sections.find(x => x.key === key.split('/')[0]);
    if (!e || !s) return;
    const p = await call(() =>
      s.repeating ? app.api.saveSchemeItem(code, s.key, e.index, e.pick, e.values) : app.api.saveSchemeSection(code, s.key, e.values),
    );
    if (p) ui.toast(t('correction.saved'));
  };

  const submitCorrections = async () => {
    if (bankFlagged && !bankValid()) return;
    const p = await call(() =>
      app.api.submitSchemeCorrection(code, { account: bankFlagged ? sentAccount() : null, cheque: chequeFlagged ? cheque : null }),
    );
    if (p) {
      ui.toast(t('correction.submitted'), { long: true });
      void app.refreshIncentiveSchemes();
    }
  };

  // ----- documents -----

  // 2026-11-25 (the user: "make it 5 mb"): the scheme documents take PDFs up to 5 MB, as the portal.
  const capturer = useScreenCapture('snackbar', undefined, 5);

  /** A document taken on the phone, uploaded at once; its stored name, or null. The phone's copy is removed after the upload. */
  const upload = async (section: string, item: number, field: FormField): Promise<string | null> => {
    const photoOnly = field.type === 'photo';
    const options = photoOnly ? [t('field.takePhoto'), t('field.pickPhoto'), t('field.cancel')] : [t('field.takePhoto'), t('field.pickPhoto'), t('field.pickPdf'), t('field.cancel')];
    const i = await ui.pickItem(t('field.sheetTitle'), options, {
      subtitle: t('field.sheetSubtitle'),
      icons: photoOnly ? ['camera', 'gallery', null] : ['camera', 'gallery', 'pdf', null],
      hints: photoOnly ? [t('field.cameraHint'), t('field.galleryHint'), null] : [t('field.cameraHint'), t('field.galleryHint'), t('field.pdfHint'), null],
      cancelIndex: options.length - 1,
    });
    const source: PhotoSource | null = i === 0 ? 'camera' : i === 1 ? 'gallery' : i === 2 && !photoOnly ? 'pdf' : null;
    if (!source) return null;
    const photo = await capturer.capture(source);
    if (!photo) return null;
    ui.showLoading();
    try {
      const r = await app.api.uploadSchemeDocument(code, section, item, field.key, photo);
      if (!isSuccess(r) || !r.upload?.fileName) {
        ui.showAlert(r?.errorMessage?.trim() || t('field.uploadFailed'));
        return null;
      }
      return r.upload.fileName;
    } catch (e) {
      ui.showAlert(isNetworkError(e) ? t('error.offline') : t('field.uploadFailed'));
      return null;
    } finally {
      ui.hideLoading();
      await removePhoto(app.photos, photo).catch(() => undefined);
    }
  };

  /** Opens one of the unit's documents (downloaded with the sign-in token). */
  const openFile = async (name: string) => {
    ui.showLoading();
    try {
      const local = await zedDevice().downloadFile(app.api.schemeDocumentUrl(code, name), name, app.session.appToken);
      if (/\.pdf$/i.test(name)) zedDevice().openPdf(local, name);
      else zedDevice().openImage(local);
    } catch {
      ui.showAlert(t('field.openFailed'));
    } finally {
      ui.hideLoading();
    }
  };

  const docs: DocActions = { upload, open: openFile };

  // ----- the page -----

  /** Why it cannot be applied for (locked / availed). */
  const lockedText = (): string => {
    if (!page) return '';
    if (page.state === 'availed') return t('availed');
    return lockedNote(t, page.note, page.scheme.activationLevels) ?? page.message ?? '';
  };

  /** The grade the eligible amount is worked out with: the open window's, or the one stored at submission. */
  const grade =
    application && application.status !== 'Draft' && application.sharePercent !== null
      ? { sharePercent: application.sharePercent, maxAmount: application.maxAmount ?? 0 }
      : page?.window?.grade ?? null;
  const liveAnswers = (): FormAnswers => {
    const base = application?.answers ?? { sections: {} };
    if (!editor) return base;
    const items = [...(base.sections[editor.section] ?? [])];
    items[editor.index] = { pick: editor.pick, values: editor.values, saved: true };
    return { sections: { ...base.sections, [editor.section]: items } };
  };
  const claim = mode === 'form' ? claimOf(scheme?.sections ?? [], liveAnswers()) : application?.claimAmount ?? 0;
  const eligible = mode === 'form' ? eligibleOf(claim, grade) : application?.eligibleAmount ?? 0;

  const claimBox = page ? (
    <View style={styles.claim} testID="scheme-claim">
      <Text style={styles.cardTitle}>{t('claim.title')}</Text>
      <Text style={styles.body}>{t('claim.claimed', { Amount: inr(claim) })}</Text>
      <Text style={[styles.body, styles.bold]} testID="scheme-eligible">
        {t('claim.eligible', { Amount: inr(eligible) })}
      </Text>
      {grade ? <Text style={styles.note}>{t('claim.grade', { Share: grade.sharePercent, Max: inr(grade.maxAmount) })}</Text> : null}
      {application?.approvedAmount ? <Text style={[styles.body, styles.ok]}>{t('claim.approved', { Amount: inr(application.approvedAmount) })}</Text> : null}
      {page.window ? <Text style={styles.note}>{t('claim.level', { Level: page.window.level })}</Text> : null}
      {page.window?.openedOn ? <Text style={styles.note}>{t('claim.openedOn', { Date: displayDate(page.window.openedOn) })}</Text> : null}
    </View>
  ) : null;

  const history =
    page && page.history.length ? (
      <View style={styles.card} testID="scheme-history">
        <Text style={styles.cardTitle}>{t('history.title')}</Text>
        {page.history.map(h => (
          <View key={h.id} style={styles.historyRow}>
            <Text style={styles.body}>{t('history.row', { Date: displayDate(h.date), Status: statusLabel(t, h.status) })}</Text>
            {h.amount !== null ? <Text style={styles.note}>{t('history.amount', { Amount: inr(h.amount) })}</Text> : null}
            {h.reason ? <Text style={styles.note}>{t('history.reason', { Reason: h.reason })}</Text> : null}
          </View>
        ))}
      </View>
    ) : null;

  const applicationCard = (heading: string) =>
    application && scheme ? (
      <View style={styles.card} testID="scheme-application">
        <View style={styles.headRow}>
          <Text style={[styles.cardTitle, { flex: 1 }]}>{heading}</Text>
          <Text style={styles.chip} testID="scheme-status">
            {statusLabel(t, application.status)}
          </Text>
        </View>
        <Answers sections={scheme.sections} answers={application.answers} checks={application.checks} t={t} onOpen={openFile} />
      </View>
    ) : null;

  const bankFields = (editable: boolean, chequeEditable: boolean, chequeRemark: string | null) => (
    <View>
      <BankInput label={t('bank.accountNo')} value={account.accountNo} numeric editable={editable} max={18} onChange={v => setAccount(a => ({ ...a, accountNo: v }))} testID="scheme-account" />
      <BankInput
        label={t('bank.accountAgain')}
        value={account.confirmAccountNo}
        numeric
        editable={editable}
        max={18}
        onChange={v => setAccount(a => ({ ...a, confirmAccountNo: v }))}
        error={account.confirmAccountNo && account.accountNo !== account.confirmAccountNo ? t('bank.mismatch') : null}
        testID="scheme-account2"
      />
      <BankInput label={t('bank.ifsc')} value={account.ifscCode} caps editable={editable} max={11} onChange={v => setAccount(a => ({ ...a, ifscCode: v }))} testID="scheme-ifsc" />
      <BankInput label={t('bank.bank')} value={account.bankName} editable={editable} max={200} onChange={v => setAccount(a => ({ ...a, bankName: v }))} testID="scheme-bank" />
      <BankInput label={t('bank.branch')} value={account.branchAddress} editable={editable} max={500} onChange={v => setAccount(a => ({ ...a, branchAddress: v }))} testID="scheme-branch" />
      <SchemeField
        field={{ key: CHEQUE_FIELD, label: t('bank.cheque'), type: 'document', required: true, maxFiles: 3 }}
        value={cheque.length ? JSON.stringify(cheque) : null}
        readonly={!chequeEditable}
        remark={chequeRemark}
        section={BANK_SECTION}
        item={0}
        onChange={v => setCheque(filesOf(v))}
        docs={docs}
        t={t}
      />
    </View>
  );

  const content = (): React.ReactNode => {
    if (!page || !scheme) return null;
    switch (mode) {
      case 'closed':
        return (
          <ScrollView contentContainerStyle={styles.page} testID="scheme-closed">
            <Text style={styles.message} testID="scheme-message">
              {lockedText()}
            </Text>
            {applicationCard(t('application.title'))}
            {history}
          </ScrollView>
        );
      case 'status':
        return (
          <ScrollView contentContainerStyle={styles.page} testID="scheme-status-page">
            {application?.status === 'OnHold' ? (
              <Text style={[styles.message, styles.warn]} testID="scheme-hold">
                {`${t('onHold')} ${holdText(t, application.holdKind)}`}
              </Text>
            ) : null}
            {claimBox}
            {applicationCard(t('application.number', { Id: application!.id }))}
            {history}
          </ScrollView>
        );
      case 'rejected':
        return (
          <ScrollView contentContainerStyle={styles.page} testID="scheme-rejected">
            <Text style={[styles.message, styles.warn]}>
              {t('rejected.title') + (application?.reason ? ` ${t('rejected.reason', { Reason: application.reason })}` : '')}
            </Text>
            {page.canApply ? (
              <ZedButton title={t('button.applyAgain')} onPress={() => void applyAgain()} style={styles.button} testID="scheme-apply-again" />
            ) : lockedText() ? (
              <Text style={styles.message}>{lockedText()}</Text>
            ) : null}
            {applicationCard(t('application.number', { Id: application!.id }))}
            {history}
          </ScrollView>
        );
      case 'correction': {
        const a = application!;
        return (
          <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID="scheme-correction">
            <Text style={[styles.message, styles.warn]} testID="scheme-correction-intro">
              {t('correction.intro', { Date: displayDate(a.correctionDueOn) }) + (a.correctionOpen ? '' : ` ${t('correction.closed')}`)}
            </Text>
            {Object.keys(fixes).map(key => {
              const e = fixes[key]!;
              const sec = scheme.sections.find(x => x.key === e.section);
              if (!sec) return null;
              const name = sec.repeating ? ` ${e.index + 1}. ${a.answers.sections[sec.key]?.[e.index]?.pickName ?? ''}` : '';
              return (
                <View key={key} style={[styles.card, styles.fix]} testID={`scheme-fix-${key}`}>
                  <Text style={styles.cardTitle}>{sec.title + name}</Text>
                  {sec.fields.map(f => {
                    const path = `${sec.key}/${e.index}/${f.key}`;
                    return (
                      <SchemeField
                        key={f.key}
                        field={f}
                        value={e.values[f.key]}
                        copy={copyOf(page, f, e.values)}
                        minDate={dateBound(f.dateMin, page.window?.openedOn, false)}
                        maxDate={dateBound(f.dateMax, page.window?.openedOn, true)}
                        readonly={!flagged.has(path) || !a.correctionOpen}
                        remark={remark(path)}
                        section={sec.key}
                        item={e.index}
                        onChange={v => setFixes(all => ({ ...all, [key]: { ...all[key]!, values: { ...all[key]!.values, [f.key]: v } } }))}
                        docs={docs}
                        t={t}
                      />
                    );
                  })}
                  <ZedButton title={t('correction.save')} disabled={!a.correctionOpen} onPress={() => void saveFix(key)} style={styles.button} testID={`scheme-fix-${key}-save`} />
                </View>
              );
            })}
            {bankFlagged || chequeFlagged ? (
              <View style={[styles.card, styles.fix]}>
                <Text style={styles.cardTitle}>{t('bank.title')}</Text>
                {bankFlagged ? <Remark text={remark(`${BANK_SECTION}/0/${ACCOUNT_FIELD}`)} t={t} /> : null}
                {bankFields(bankFlagged && a.correctionOpen, chequeFlagged && a.correctionOpen, chequeFlagged ? remark(`${BANK_SECTION}/0/${CHEQUE_FIELD}`) : null)}
              </View>
            ) : null}
            <ZedButton
              title={t('correction.submit')}
              disabled={!a.correctionOpen}
              onPress={() => void submitCorrections()}
              style={styles.button}
              testID="scheme-submit-corrections"
            />
            {applicationCard(t('application.number', { Id: a.id }))}
          </ScrollView>
        );
      }
      case 'form':
        return step ? (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID={`scheme-step-${step.kind}`}>
              <Text style={styles.stepOf}>{t('step.of', { Step: stepIndex + 1, Total: steps.length })}</Text>
              <Text style={textStyles.subheading}>{step.kind === 'unit' ? t('unit.title') : step.kind === 'bank' ? t('bank.title') : step.label}</Text>
              {stepContent(step)}
            </ScrollView>
            <Footer
              onBack={() => (stepIndex === 0 ? nav.pop() : void go(stepIndex - 1))}
              backTitle={t('button.back')}
              onProceed={() => void next()}
              proceedTitle={
                step.kind === 'summary'
                  ? t('button.submit')
                  : step.kind === 'disclaimer' || step.kind === 'instructions'
                    ? t('button.accept')
                    : step.kind === 'section' && !step.section?.repeating
                      ? t('button.saveProceed')
                      : t('button.proceed')
              }
              proceedEnabled={!(step.kind === 'disclaimer' && !consent) && !(step.kind === 'summary' && scheme.blocks.declaration && !declaration)}
              backTestID="scheme-back"
              proceedTestID="scheme-next"
            />
          </View>
        ) : null;
    }
  };

  const stepContent = (s: Step): React.ReactNode => {
    const p = page!;
    const sc = p.scheme;
    switch (s.kind) {
      case 'disclaimer':
        return (
          <View>
            <SchemeText own={sc.disclaimer} fallbackKey="app.msme.schemes.fa.disclaimer" testID="scheme-disclaimer" />
            <CheckBox label={t('disclaimer.consent')} checked={consent} onChange={setConsent} testID="scheme-consent" />
          </View>
        );
      case 'instructions':
        return <SchemeText own={sc.instructions} fallbackKey="app.msme.schemes.fa.instructions" testID="scheme-instructions" />;
      case 'unit': {
        const u = p.unit;
        const v = (k: string) => (u[k] == null ? '' : String(u[k]));
        return (
          <View>
            <View style={styles.card}>
              <Row label={t('unit.enterprise')} value={v('EnterpriseName')} />
              <Row label={t('unit.zedId')} value={v('ZedId')} />
              <Row label={t('unit.udyam')} value={v('UdyogAadharNo')} />
              <Row label={t('unit.size')} value={v('EnterpriseType')} />
              <Row label={t('unit.unit')} value={v('PUnitName')} />
              <Row label={t('unit.activity')} value={`${v('Activity')} ${v('TwoDigitActivity')}`.trim()} />
              <Row label={t('unit.address')} value={[v('PAddress'), v('PDistrictName'), v('PStateName'), v('PPin')].filter(Boolean).join(' ')} />
            </View>
            {sc.blocks.unitConfirm ? <CheckBox label={t('unit.confirm')} checked={unitConfirmed} onChange={setUnitConfirmed} testID="scheme-unit-confirm" /> : null}
          </View>
        );
      }
      case 'section': {
        const sec = s.section!;
        const items = itemsOf(p, sec);
        return (
          <View>
            {claimBox}
            {sec.help ? <Text style={styles.note}>{sec.help}</Text> : null}
            {sec.repeating ? <Text style={styles.note}>{t('items.count', { Count: items.length, Max: sec.maxItems })}</Text> : null}
            {sec.repeating
              ? items.map((item, i) =>
                  editor?.index === i ? null : (
                    <View key={i} style={styles.item} testID={`scheme-item-${i}`}>
                      <Text style={styles.bold}>{`${i + 1}. ${item.pickName || item.pick || t('items.item')}`}</Text>
                      <Text style={styles.note}>
                        {`₹ ${inr(claimOf([sec], { sections: { [sec.key]: [{ ...item, saved: true }] } }))} · ${t('items.docs', {
                          Count: sec.fields.filter(f => f.type === 'document' || f.type === 'photo').reduce((n, f) => n + filesOf(item.values[f.key]).length, 0),
                        })}`}
                      </Text>
                      {!editor ? (
                        <View style={styles.itemActions}>
                          <OutlinedButton title={t('items.edit')} onPress={() => openItem(sec, i)} testID={`scheme-item-${i}-edit`} />
                          <OutlinedButton title={t('items.remove')} color={colors.error} onPress={() => void removeItem(sec, i)} testID={`scheme-item-${i}-remove`} />
                        </View>
                      ) : null}
                    </View>
                  ),
                )
              : null}
            {editor && editor.section === sec.key ? (
              <View style={sec.repeating ? styles.editor : undefined} testID="scheme-editor">
                {sec.repeating ? <Text style={styles.cardTitle}>{`${sec.title} ${editor.index + 1}`}</Text> : null}
                {sec.pick ? (
                  <PickField
                    label={sec.pick.label || t('items.pickLabel')}
                    entries={picksFor(p, sec, editor.index)}
                    value={editor.pick}
                    onChange={code => setEditor(e => (e ? { ...e, pick: code } : e))}
                  />
                ) : null}
                {sec.fields.map(f => (
                  <SchemeField
                    key={f.key}
                    field={f}
                    value={editor.values[f.key]}
                    copy={copyOf(p, f, editor.values)}
                    minDate={dateBound(f.dateMin, p.window?.openedOn, false)}
                    maxDate={dateBound(f.dateMax, p.window?.openedOn, true)}
                    section={sec.key}
                    item={editor.index}
                    onChange={v => setEditor(e => (e ? { ...e, values: { ...e.values, [f.key]: v } } : e))}
                    docs={docs}
                    t={t}
                  />
                ))}
                {sec.repeating ? (
                  <View style={styles.itemActions}>
                    <OutlinedButton title={t('items.cancel')} onPress={() => setEditor(null)} testID="scheme-cancel-item" />
                    <ZedButton title={t('items.save')} onPress={() => void saveEditor()} small testID="scheme-save-item" />
                  </View>
                ) : null}
              </View>
            ) : null}
            {sec.repeating && !editor && items.length < sec.maxItems ? (
              <Pressable style={styles.addMore} onPress={() => openItem(sec, items.length)} testID="scheme-add-more">
                <Text style={styles.addMoreText}>{t('items.add', { Section: sec.title })}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }
      case 'bank':
        return bankFields(true, true, null);
      case 'summary':
        return (
          <View>
            {claimBox}
            {application ? <Answers sections={sc.sections} answers={application.answers} checks={[]} t={t} onOpen={openFile} /> : null}
            {sc.blocks.bankAccount ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('bank.title')}</Text>
                <Row label={t('bank.accountNo')} value={account.accountNo} />
                <Row label={t('bank.ifsc')} value={account.ifscCode.toUpperCase()} />
                <Row label={t('bank.bankBranch')} value={`${account.bankName}, ${account.branchAddress}`} />
              </View>
            ) : null}
            {sc.blocks.declaration ? <Declaration own={sc.declaration} checked={declaration} onChange={setDeclaration} /> : null}
          </View>
        );
    }
  };

  return (
    <ScreenFrame title={title} backBar={{ zedId, onBack: () => nav.pop() }} testID="incentive-scheme">
      {error != null ? (
        <View style={{ flex: 1 }} testID="scheme-error">
          <View style={styles.centre}>
            <Text style={styles.message}>{error}</Text>
          </View>
          <Footer onBack={() => nav.pop()} backTitle={t('button.back')} proceedTitle={t('button.retry')} onProceed={() => void load()} proceedTestID="scheme-retry" />
        </View>
      ) : (
        content()
      )}
    </ScreenFrame>
  );
}

// ----- helpers -----

/** The items with an answer found not valid ("section/index"), the bank block apart. */
function flaggedItems(p: SchemePage): string[] {
  const keys = (p.application?.checks ?? []).map(c => c.path.split('/')).filter(x => x[0] !== BANK_SECTION).map(x => `${x[0]}/${x[1]}`);
  return [...new Set(keys)];
}

/** The value a copy field shows: the field of the same item, or "section.field" of a plain section. */
function copyOf(p: SchemePage, f: FormField, values: Record<string, string | null>): string | null {
  const source = f.copyOf ?? '';
  const dot = source.indexOf('.');
  if (dot < 0) return values[source] ?? null;
  return p.application?.answers.sections[source.slice(0, dot)]?.[0]?.values[source.slice(dot + 1)] ?? null;
}

/** The entries an item may pick: the section's list, without those other items picked (NoRepeat). */
function picksFor(p: SchemePage, s: FormSection, index: number): PickEntry[] {
  const all = p.picks[s.key] ?? [];
  if (!s.pick?.noRepeat) return all;
  const taken = new Set((p.application?.answers.sections[s.key] ?? []).filter((_, i) => i !== index).map(i => i.pick));
  return all.filter(e => !taken.has(e.code));
}

const ymdToMillis = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : -1;
};

// ----- components -----

type DocActions = { upload: (section: string, item: number, field: FormField) => Promise<string | null>; open: (name: string) => void };

/** The scheme's own text (plain), else the app's standard wording (an Admin text). */
function SchemeText({ own, fallbackKey, testID }: { own?: string | null; fallbackKey: string; testID: string }) {
  const fallback = useAppText(fallbackKey);
  if (own) return <Text style={[styles.body, { marginBottom: dimens.padding2 }]} testID={testID}>{own}</Text>;
  return fallback ? <HtmlText html={fallback.html} style={styles.body} testID={testID} /> : null;
}

function Declaration({ own, checked, onChange }: { own?: string | null; checked: boolean; onChange: (v: boolean) => void }) {
  const fallback = useAppText('app.msme.schemes.fa.accountDeclaration.checkbox');
  const label = own || (fallback ? fallback.html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') : '');
  return (
    <View style={styles.declaration}>
      <CheckBox label={label} checked={checked} onChange={onChange} testID="scheme-declaration" />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Remark({ text, t }: { text: string | null; t: SchemeT }) {
  if (text === null) return null;
  return <Text style={styles.remark}>{t('field.notValid') + (text ? `: ${text}` : '')}</Text>;
}

function BankInput({
  label,
  value,
  onChange,
  editable,
  numeric,
  caps,
  max,
  error,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  numeric?: boolean;
  caps?: boolean;
  max: number;
  error?: string | null;
  testID: string;
}) {
  return (
    <View>
      <FieldLabel label={`${label} *`} />
      <OutlinedInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        keyboardType={numeric ? 'numeric' : 'default'}
        autoCapitalize={caps ? 'characters' : 'sentences'}
        maxLength={max}
        error={error}
        testID={testID}
      />
    </View>
  );
}

function PickField({ label, entries, value, onChange }: { label: string; entries: PickEntry[]; value: string | null; onChange: (code: string | null) => void }) {
  const current = entries.find(e => e.code === value)?.name ?? '';
  return (
    <SelectionPicker
      label={`${label} *`}
      items={entries.map(e => e.name)}
      value={current}
      onChange={name => onChange(entries.find(e => e.name === name)?.code ?? null)}
      testID="scheme-pick"
    />
  );
}

/**
 * One field of a scheme's form, drawn by its type (as the web's zed-scheme-field): text / long text with a counter, number,
 * amount (₹), date within its bounds, choice, multiple choice, yes / no, copy (read only) and document / photo (the files with
 * View / Remove and "+ Upload" up to the field's files). The value is a string as the portal keeps it (a JSON list for documents
 * and multiple choice).
 */
function SchemeField({
  field: f,
  value,
  onChange,
  readonly = false,
  remark,
  copy,
  minDate = '',
  maxDate = '',
  section,
  item,
  docs,
  t,
}: {
  field: FormField;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  readonly?: boolean;
  remark?: string | null;
  copy?: string | null;
  minDate?: string;
  maxDate?: string;
  section: string;
  item: number;
  docs: DocActions;
  t: SchemeT;
}) {
  const id = `scheme-field-${section}-${item}-${f.key}`;
  const set = (v: string) => onChange(v === '' ? null : v);
  const label = f.label + (f.required && f.type !== 'copy' ? ' *' : '');
  const maxLength = f.maxLength ?? (f.type === 'longtext' ? 2000 : 200);
  const [uploading, setUploading] = useState(false);

  const input = (): React.ReactNode => {
    switch (f.type) {
      case 'longtext':
        return <OutlinedInput value={value ?? ''} onChangeText={set} multiline maxLength={maxLength} showCounter editable={!readonly} testID={id} />;
      case 'number':
      case 'amount':
        return (
          <OutlinedInput
            value={value ?? ''}
            onChangeText={v => set(v.replace(f.type === 'amount' || !f.wholeNumber ? /[^\d.]/g : /[^\d]/g, ''))}
            keyboardType={f.type === 'amount' || !f.wholeNumber ? 'decimal-pad' : 'numeric'}
            editable={!readonly}
            right={f.type === 'amount' ? <Text style={styles.rupee}>₹</Text> : undefined}
            testID={id}
          />
        );
      case 'date':
        return (
          <OutlinedInput
            value={displayDate(value)}
            editable={false}
            placeholder={t('field.datePlaceholder')}
            onPress={
              readonly
                ? undefined
                : async () => {
                    const d = await zedDevice().pickDateInRange(value ?? null, minDate ? ymdToMillis(minDate) : -1, maxDate ? ymdToMillis(maxDate) : -1);
                    if (d) onChange(d);
                  }
            }
            testID={id}
          />
        );
      case 'choice': {
        const options = f.options ?? [];
        if (options.length > 4)
          return readonly ? (
            <OutlinedInput value={value ?? ''} editable={false} testID={id} />
          ) : (
            <SelectionPicker items={options} value={value ?? ''} onChange={set} testID={id} />
          );
        return (
          <View style={styles.radios} testID={id}>
            {options.map(o => (
              <RadioButton key={o} label={o} selected={value === o} onPress={() => !readonly && set(o)} testID={`${id}-${o}`} />
            ))}
          </View>
        );
      }
      case 'multichoice': {
        const picked = filesOf(value);
        return (
          <CheckBoxGroup
            options={f.options ?? []}
            value={picked}
            onChange={list => !readonly && onChange(list.length ? JSON.stringify(list) : null)}
            testID={id}
          />
        );
      }
      case 'yesno':
        return (
          <View style={styles.radios} testID={id}>
            <RadioButton label={t('field.yes')} selected={value === 'Yes'} onPress={() => !readonly && set('Yes')} testID={`${id}-Yes`} />
            <RadioButton label={t('field.no')} selected={value === 'No'} onPress={() => !readonly && set('No')} testID={`${id}-No`} />
          </View>
        );
      case 'copy':
        return <OutlinedInput value={copy ?? ''} editable={false} testID={id} />;
      case 'document':
      case 'photo': {
        const files = filesOf(value);
        const max = Math.min(Math.max(f.maxFiles ?? 1, 1), 3);
        return (
          <View style={styles.files} testID={id}>
            {files.length ? (
              files.map((name, i) => (
                <View key={name} style={styles.fileRow}>
                  <Text style={styles.fileName} onPress={() => docs.open(name)} accessibilityRole="link" testID={`${id}-file-${i}`}>
                    {/\.pdf$/i.test(name) ? t('field.pdf', { Number: i + 1 }) : t('field.image', { Number: i + 1 })}
                  </Text>
                  {!readonly ? (
                    <Pressable
                      onPress={() => {
                        const left = files.filter(n => n !== name);
                        onChange(left.length ? JSON.stringify(left) : null);
                      }}
                      hitSlop={12}
                      testID={`${id}-remove-${i}`}>
                      <Text style={styles.removeFile}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            ) : (
              <Text style={styles.note}>{t('field.noFile')}</Text>
            )}
            {!readonly && files.length < max ? (
              <ZedButton
                title={uploading ? t('field.uploading') : t('field.upload')}
                allCaps={false}
                small
                disabled={uploading}
                style={styles.upload}
                onPress={async () => {
                  setUploading(true);
                  try {
                    const name = await docs.upload(section, item, f);
                    if (name) onChange(JSON.stringify([...filesOf(value), name]));
                  } finally {
                    setUploading(false);
                  }
                }}
                testID={`${id}-upload`}
              />
            ) : null}
            <Text style={styles.note}>{f.type === 'photo' ? t('field.photoHint', { Count: max }) : t('field.documentHint', { Count: max })}</Text>
          </View>
        );
      }
      default:
        return <OutlinedInput value={value ?? ''} onChangeText={set} maxLength={maxLength} showCounter editable={!readonly} testID={id} />;
    }
  };

  return (
    <View style={[styles.field, remark != null && styles.flagged]}>
      <FieldLabel label={label} />
      {f.help ? <Text style={styles.note}>{f.help}</Text> : null}
      <Remark text={remark ?? null} t={t} />
      {input()}
    </View>
  );
}

/** The answers of an application, read only: each section with its items, documents as links, the answers found not valid marked. */
function Answers({
  sections,
  answers,
  checks,
  t,
  onOpen,
}: {
  sections: FormSection[];
  answers: FormAnswers;
  checks: { path: string; remarks: string | null }[];
  t: SchemeT;
  onOpen: (name: string) => void;
}) {
  const show = (item: FormItem, f: FormField): string => {
    const v = item.values[f.key];
    if (v === null || v === undefined || v === '') return '—';
    if (f.type === 'amount') return `₹ ${inr(v)}`;
    if (f.type === 'multichoice') return filesOf(v).join(', ');
    if (f.type === 'date') return displayDate(v);
    return v;
  };
  return (
    <View testID="scheme-answers">
      {sections.map(s => {
        const items = (answers.sections[s.key] ?? []).filter(i => i.saved || !s.repeating);
        return (
          <View key={s.key} style={styles.answersSection}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            {items.length === 0 ? <Text style={styles.note}>{t('answers.none')}</Text> : null}
            {items.map((item, i) => (
              <View key={i} style={styles.answersItem}>
                {s.repeating ? <Text style={styles.bold}>{`${i + 1}. ${item.pickName || item.pick || t('items.item')}`}</Text> : null}
                {s.fields.map(f => {
                  const check = checks.find(c => c.path === `${s.key}/${i}/${f.key}`);
                  const files = f.type === 'document' || f.type === 'photo' ? filesOf(item.values[f.key]) : null;
                  return (
                    <View key={f.key} style={[styles.row, check ? styles.flagged : null]}>
                      <Text style={styles.rowLabel}>{f.label}</Text>
                      <View style={{ flex: 1 }}>
                        {files ? (
                          files.length ? (
                            files.map((n, k) => (
                              <Text key={n} style={styles.fileName} onPress={() => onOpen(n)} accessibilityRole="link">
                                {t('answers.view', { Number: k + 1 })}
                              </Text>
                            ))
                          ) : (
                            <Text style={styles.rowValue}>—</Text>
                          )
                        ) : (
                          <Text style={styles.rowValue}>{show(item, f)}</Text>
                        )}
                        {check ? <Remark text={check.remarks ?? ''} t={t} /> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { margin: dimens.padding2, padding: dimens.padding2, backgroundColor: colors.white, flexGrow: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: dimens.padding4 },
  stepOf: { color: colors.labelColor, fontSize: dimens.textSize14 },
  body: { color: colors.black, fontSize: dimens.textSize },
  bold: { fontWeight: 'bold', color: colors.black, fontSize: dimens.textSize },
  ok: { color: colors.green, fontWeight: 'bold' },
  note: { color: colors.labelColor, fontSize: dimens.textSize14, marginVertical: 2 },
  message: { ...shapes.greyRectangle, padding: dimens.padding3, color: colors.black, fontSize: dimens.textSize, marginVertical: dimens.padding2 },
  warn: { backgroundColor: colors.yellow },
  card: { ...shapes.greyOutlineRectangle, padding: dimens.padding2, marginVertical: dimens.padding2 },
  fix: { borderColor: '#F0C36D' },
  claim: { ...shapes.lightGreyOutlineFilled, padding: dimens.padding2, marginVertical: dimens.padding2 },
  cardTitle: { ...textStyles.defaultLabel },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    paddingHorizontal: dimens.padding2,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
    fontSize: dimens.textSize14,
    fontWeight: 'bold',
    backgroundColor: '#E3EEF6',
    color: '#1F4F7A',
  },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.lightGrey },
  rowLabel: { width: 140, color: colors.labelColor, fontSize: dimens.textSize14, paddingRight: dimens.padding1 },
  rowValue: { flex: 1, color: colors.black, fontSize: dimens.textSize14, fontWeight: 'bold' },
  historyRow: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.lightGrey },
  item: { ...shapes.greyRectangle, padding: dimens.padding2, marginVertical: dimens.padding1 },
  itemActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: dimens.padding1 },
  editor: { ...shapes.greyOutlineRectangle, padding: dimens.padding2, marginVertical: dimens.padding2 },
  addMore: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.appColor,
    borderRadius: 5,
    padding: dimens.padding3,
    alignItems: 'center',
    marginVertical: dimens.padding2,
  },
  addMoreText: { color: colors.appColor, fontWeight: 'bold', fontSize: dimens.textSize },
  field: { marginVertical: dimens.padding1 },
  flagged: { backgroundColor: '#FFFAF0' },
  remark: { color: '#8A5A00', fontSize: dimens.textSize14, marginVertical: 2 },
  radios: { flexDirection: 'row', flexWrap: 'wrap' },
  rupee: { color: colors.labelColor, fontSize: dimens.textSize, paddingHorizontal: dimens.padding2 },
  files: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.progressBarColor, borderRadius: 5, padding: dimens.padding2 },
  fileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...shapes.greyRectangle, padding: dimens.padding2, marginBottom: dimens.padding1 },
  fileName: { color: colors.appColor, fontWeight: 'bold', fontSize: dimens.textSize14, textDecorationLine: 'underline' },
  removeFile: { fontSize: 20, color: colors.labelColor, paddingHorizontal: dimens.padding2 },
  upload: { alignSelf: 'flex-start', marginVertical: dimens.padding1 },
  button: { marginVertical: dimens.padding2 },
  declaration: { backgroundColor: colors.activitySelectTextBackground, borderRadius: dimens.padding1, padding: dimens.padding1, marginVertical: dimens.padding2 },
  answersSection: { marginVertical: dimens.padding1 },
  answersItem: { marginBottom: dimens.padding2 },
  sectionTitle: { fontSize: dimens.textSize14, fontWeight: 'bold', color: colors.appColor, marginVertical: dimens.padding1, textTransform: 'uppercase' },
});
