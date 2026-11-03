import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { htmlToPlain, isSuccess, NUMERIC_MAX_LENGTH, numericFilter, PhotosField, useAppText, useBackHandler, useNavigation, useUi, zedDevice, type PhotoData } from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { failureMessage, finalSubmitTechnologyUpgradation, refusalMessage, technologyUpgradationSubmitted } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import {
  DATA_SUBMITTED,
  hasVerificationData,
  isAccepted,
  NO,
  PLEASE_ENTER_DETAILS,
  shouldAskForAttachments,
  tu,
  twoDecimals,
  validateVerificationData,
  YES,
  type CertificationDetails,
  type ConsultantPhoto,
  type FinancialAssistanceDetailsResponse,
  type FinancialAssistanceDocument,
  type TechnologyDetails,
} from '../models';
import { Badge, C, Card, Field, HeroHeader, Page, SectionLabel, z, ZButton, ZIcon, ZScroll } from '../ui/zed';

const DOCUMENTS_VALIDATION_ERROR = 'Please validate all the documents';
const TITLE = 'Technology Upgradation';

/** TechnologyDetails' getters: label and value when the value is there. */
function technologyRows(t: TechnologyDetails): Array<[string, string]> {
  const rows: Array<[string, string | null | undefined]> = [
    ['Name of Manufacturer', t.NameOfTheManufaturer],
    ['Make/Model Name', t.MakeOrModelName],
    ['Date of Purchase', t.DateOfPurchase],
    ['Name of Agency/Supplier', t.AgencyOrSupplier],
    ['Invoice/Bill No.', t.InvoiceNo],
    ['Invoice/Bill Date', t.InvoiceBillDate],
  ];
  return rows.filter((r): r is [string, string] => r[1] != null);
}

/** A read-only detail: label above the value, an edit icon when it can be changed. */
function ReadOnlyField({ label, value, onEdit, last, testID }: { label: string; value: string; onEdit?: () => void; last?: boolean; testID?: string }) {
  return (
    <View style={[styles.detail, !last && styles.detailDivider]} testID={testID}>
      <View style={styles.flex}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue} testID={testID ? `${testID}-value` : undefined}>
          {value}
        </Text>
      </View>
      {onEdit ? (
        <Pressable onPress={onEdit} hitSlop={8} style={styles.editIcon} accessibilityLabel="Edit" testID={testID ? `${testID}-edit` : undefined}>
          <ZIcon name="edit" size={20} color={C.primaryDark} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * TechnologyUpgradationActivity (fourth milestone, the DFO's verification): the unit's application from the
 * consultancy web site, its technologies (each verified on its own page), the certificate and cancelled cheque, the
 * summary, and the final submission (accept or reject).
 */
export function TechnologyUpgradationScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const d = app.details!;
  const cert = d.certificationType ?? '';
  const [data, setData] = useState<FinancialAssistanceDetailsResponse | null>(null);
  const [selected, setSelected] = useState<TechnologyDetails | null>(null);
  const [, rerender] = useState(0);
  const refresh = () => rerender(x => x + 1);

  useEffect(() => {
    (async () => {
      ui.showLoading();
      try {
        setData(await app.api.financialAssistanceDetails(app.zedId));
      } catch (e) {
        ui.showAlert(failureMessage(e));
        ui.snackbar('Error occurred while getting data');
      } finally {
        ui.hideLoading();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = () => {
    if (selected) {
      setSelected(null);
    } else {
      ui.alert('Alert', 'Any changes you made will not be saved, would you like to proceed?', [
        { text: 'Yes', onPress: () => nav.pop() },
        { text: 'No', style: 'cancel' },
      ]);
    }
  };
  useBackHandler(() => {
    goBack();
    return true;
  });

  const header = <HeroHeader title={selected ? 'Technology Details' : TITLE} subtitle={app.zedId} onBack={goBack} />;
  if (!data) return <Page testID="technology-upgradation">{header}</Page>;

  const finalSubmit = async (details: CertificationDetails) => {
    if (await app.store.meeting(app.userId, true)) {
      ui.alert('Alert', 'There is pending open meeting data to be submitted, please sync that first.', [{ text: 'OK', onPress: () => nav.push('SubmitParameters') }], false);
      return;
    }
    ui.showLoading();
    try {
      const r = await finalSubmitTechnologyUpgradation(app, details);
      ui.hideLoading();
      if (isSuccess(r)) {
        await technologyUpgradationSubmitted(app);
        ui.alert('Alert', DATA_SUBMITTED, [{ text: 'OK', onPress: () => nav.replace('Attendance') }], false);
      }
    } catch (e) {
      ui.hideLoading();
      ui.showAlert(failureMessage(e));
    }
  };

  const onFinalSubmission = () => {
    const details = tu.certificationDetails(data, cert);
    if (!details) return;
    ui.custom(
      close => (
        <RejectCommentDialog
          existing={[isAccepted(details), details.Comments ?? null]}
          onClose={close}
          onSubmit={(accepted, comment) => {
            close();
            details.Comments = comment;
            details.IsApproved = accepted ? 1 : 2;
            finalSubmit(details);
          }}
        />
      ),
      () => undefined,
    );
  };

  return (
    <Page testID="technology-upgradation">
      {header}
      {selected ? (
        <TechnologyDetailsView app={app} data={data} cert={cert} technology={selected} onDone={() => (setSelected(null), refresh())} onValidated={refresh} />
      ) : (
        <TechnologiesList app={app} data={data} cert={cert} onSelect={setSelected} onFinalSubmission={onFinalSubmission} onValidated={refresh} />
      )}
    </Page>
  );
}

/** TechnologiesListFragment */
function TechnologiesList({
  app,
  data,
  cert,
  onSelect,
  onFinalSubmission,
  onValidated,
}: {
  app: SaApp;
  data: FinancialAssistanceDetailsResponse;
  cert: string;
  onSelect: (t: TechnologyDetails) => void;
  onFinalSubmission: () => void;
  onValidated: () => void;
}) {
  const items = tu.technologies(data, cert) ?? [];
  const certificate = tu.copyOfCertificate(data, cert);
  const cheque = tu.copyOfCancelledCheque(data, cert);
  const anyIncomplete = items.some(t => !t.isCompleted);
  const enabled = !anyIncomplete && (certificate == null || !!certificate.isValidateClicked) && (cheque == null || !!cheque.isValidateClicked);
  const done = items.filter(t => t.isCompleted).length;
  return (
    <ZScroll contentContainerStyle={z.screenPad}>
      <SectionLabel label="Technologies" right={<Text style={z.muted}>{`${done} of ${items.length} completed`}</Text>} />
      {items.map((t, i) => (
        <Card key={`${t.Id}-${i}`} onPress={() => onSelect(t)} style={styles.techRow} testID={`tu-tech-${i}`}>
          <View style={[styles.well, !t.isCompleted && { backgroundColor: C.muted }]}>
            <ZIcon name="settings" size={20} color={t.isCompleted ? C.primary : C.tMuted} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.techName}>{t.TechnologyName ?? ''}</Text>
            <View style={styles.techMeta}>
              <Badge label={t.isCompleted ? 'Completed' : 'Not Completed'} tone={t.isCompleted ? 'success' : 'neutral'} small testID={`tu-tech-${i}-status`} />
            </View>
          </View>
          <ZIcon name="chevron-right" size={18} color={C.tMuted} />
        </Card>
      ))}
      {certificate ? (
        <>
          <SectionLabel label="Certificate" style={styles.section} />
          <DocumentRow app={app} document={certificate} technologyCode="" onValidated={onValidated} testID="tu-certificate" />
        </>
      ) : null}
      <SectionLabel label="Financial Details" style={styles.section} />
      {cheque ? <DocumentRow app={app} document={cheque} technologyCode="" onValidated={onValidated} testID="tu-cheque" /> : null}
      <Summary data={data} cert={cert} items={items} />
      <ZButton title="Final Submission" disabled={!enabled} onPress={onFinalSubmission} style={styles.bigButton} testID="tu-final-submission" />
      {!enabled ? <Text style={styles.hint}>Complete every technology and validate the documents first.</Text> : null}
    </ZScroll>
  );
}

/** TechnologiesListFragment.showSummary: the technologies whose documents were accepted, the total and the eligible amount. */
function Summary({ data, cert, items }: { data: FinancialAssistanceDetailsResponse; cert: string; items: TechnologyDetails[] }) {
  const details = tu.certificationDetails(data, cert);
  const percentage = details?.EligibleSubsidyPer;
  const maxSubsidy = details?.MaxEligibleSubsidy;
  if (percentage == null || maxSubsidy == null) return null;
  const accepted = items.filter(t => t.TechnologyCode != null && !tu.isAnyDocumentRejected(data, cert, t.TechnologyCode));
  if (accepted.length === 0) return null;
  let total = 0;
  for (const t of accepted) {
    const amount = Number(t.AmountPaid);
    if (t.AmountPaid != null && Number.isFinite(amount)) total += amount;
  }
  const eligible = (total * percentage) / 100;
  return (
    <View>
      <SectionLabel label="Summary" style={styles.section} />
      <Card style={styles.summary} testID="tu-summary">
        <SummaryRow label="Name of Technology" value="Amount (Rs.)" head />
        {accepted.map((t, i) => (
          <SummaryRow key={`${t.Id}-${i}`} label={t.TechnologyName ?? ''} value={twoDecimals(t.AmountPaid) ?? ''} />
        ))}
        <SummaryRow label="Total Amount" value={twoDecimals(total) ?? ''} bold />
        {/* The legacy showed a fixed 300000.00 above the maximum, whatever the maximum was. */}
        <SummaryRow label="Technology Support Eligible Amount" value={eligible <= maxSubsidy ? (twoDecimals(eligible) ?? '') : '300000.00'} bold accent />
      </Card>
    </View>
  );
}

function SummaryRow({ label, value, bold, head, accent }: { label: string; value: string; bold?: boolean; head?: boolean; accent?: boolean }) {
  return (
    <View style={[styles.summaryRow, (bold || head) && styles.summaryRule]}>
      <Text style={[styles.summaryLabel, head && styles.summaryHead, bold && styles.summaryBold]}>{label}</Text>
      <Text style={[styles.summaryValue, head && styles.summaryHead, bold && styles.summaryBold, accent && { color: C.primaryDark }]}>{value}</Text>
    </View>
  );
}

/** showDetails / showCertificationDetails: the technology's details and documents, PROCEED. */
function TechnologyDetailsView({
  app,
  data,
  cert,
  technology: t,
  onDone,
  onValidated,
}: {
  app: SaApp;
  data: FinancialAssistanceDetailsResponse;
  cert: string;
  technology: TechnologyDetails;
  onDone: () => void;
  onValidated: () => void;
}) {
  const ui = useUi();
  const code = t.TechnologyCode ?? '';
  const [amount, setAmount] = useState(t.AmountPaid ?? '');
  const purchased = tu.purchasedTechnology(data, cert, code);
  const invoice = tu.copyOfInvoice(data, cert, code);
  const validated = !!invoice?.isValidateClicked && !!purchased?.isValidateClicked;

  const editAmount = () =>
    ui.custom(
      close => (
        <AmountDialog
          initial={amount}
          onDone={v => {
            close();
            if (v != null) setAmount(v);
          }}
        />
      ),
      () => undefined,
    );

  const proceed = async () => {
    if ((t.AmountPaid ?? '') !== amount) {
      if (!t.Id || amount === '') return;
      ui.showLoading();
      try {
        const r = await app.api.updateTechnology(app.zedId, t.Id, amount);
        ui.hideLoading();
        if (!isSuccess(r)) return r?.errorMessage ? ui.showAlert(r.errorMessage) : undefined;
        t.AmountPaid = amount;
      } catch (e) {
        ui.hideLoading();
        return ui.showAlert(failureMessage(e));
      }
    }
    if (!invoice?.isValidateClicked || !purchased?.isValidateClicked) return ui.snackbar(DOCUMENTS_VALIDATION_ERROR);
    t.isCompleted = true;
    onDone();
  };

  const rows: Array<{ label: string; value: string; onEdit?: () => void; testID?: string }> = technologyRows(t).map(([label, value]) => ({ label, value }));
  if (t.AmountPaid != null) rows.push({ label: 'Amount Paid before GST (Rs.)', value: amount, onEdit: editAmount, testID: 'tu-amount' });
  if (t.ModeOfPayment != null) rows.push({ label: 'Mode of Payment', value: t.ModeOfPayment });

  return (
    <ZScroll contentContainerStyle={z.screenPad}>
      <Card>
        <Text style={styles.cardLabel}>Technology Details</Text>
        <Text style={styles.techTitle} testID="tu-tech-title">
          {t.TechnologyName ?? ''}
        </Text>
      </Card>
      {rows.length > 0 ? (
        <Card style={styles.details}>
          {rows.map((row, i) => (
            <ReadOnlyField key={row.label} label={row.label} value={row.value} onEdit={row.onEdit} last={i === rows.length - 1} testID={row.testID} />
          ))}
        </Card>
      ) : null}
      {purchased || invoice ? <SectionLabel label="Documents" style={styles.section} /> : null}
      {purchased ? <DocumentRow app={app} document={purchased} technologyCode={code} onValidated={onValidated} testID="tu-purchased" /> : null}
      {invoice ? <DocumentRow app={app} document={invoice} technologyCode={code} onValidated={onValidated} testID="tu-invoice" /> : null}
      <ZButton title="Proceed" disabled={!validated} onPress={proceed} style={styles.bigButton} testID="tu-proceed" />
      {!validated ? <Text style={styles.hint}>Validate both documents to proceed.</Text> : null}
    </ZScroll>
  );
}

/** A dialog in the redesign's look: white card, bold title and the close icon. */
function ZDialog({ title, onClose, children, testID }: { title?: string | null; onClose?: () => void; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.dialog} testID={testID}>
      <View style={styles.dialogHead}>
        <Text style={styles.dialogTitle}>{title ?? ''}</Text>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} testID="dialog-close" accessibilityLabel="Close">
            <ZIcon name="close" size={20} color={C.tSecondary} />
          </Pressable>
        ) : null}
      </View>
      <ZScroll keyboardShouldPersistTaps="handled">{children}</ZScroll>
    </View>
  );
}

/** TextInputHelper.showInputAlert: "Enter Value" (numeric), OK / Cancel. */
function AmountDialog({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ZDialog title="Enter Value" testID="amount-dialog">
      <Field value={value} onChangeText={t => setValue(numericFilter(t))} keyboardType="number-pad" maxLength={NUMERIC_MAX_LENGTH} testID="amount-input" />
      <View style={styles.dialogButtons}>
        <ZButton title="Cancel" variant="ghost" small onPress={() => onDone(null)} style={styles.flex} testID="amount-cancel" />
        <ZButton title="OK" small onPress={() => onDone(value)} style={styles.flex} testID="amount-ok" />
      </View>
    </ZDialog>
  );
}

/** layout_review_item for a document: its image (or the PDF icon), name and date, VIEW, VALIDATE / EDIT. */
function DocumentRow({ app, document, technologyCode, onValidated, testID }: { app: SaApp; document: FinancialAssistanceDocument; technologyCode: string; onValidated: () => void; testID: string }) {
  const ui = useUi();
  const [viewed, setViewed] = useState(false);
  const photoId = document.PhotoId ?? '';
  const isPdf = photoId.toLowerCase().endsWith('.pdf');
  const url = photoId ? app.api.technologyUpgradationPhotoUrl(app.zedId, photoId) : null;
  const hasData = hasVerificationData(document);

  const view = async () => {
    if (!url) return;
    ui.showLoading();
    try {
      const path = await zedDevice().downloadFile(url, photoId, app.session.appToken);
      setViewed(true);
      if (isPdf) zedDevice().openPdf(path, photoId);
      else zedDevice().openImage(path);
    } catch (e) {
      ui.showAlert(failureMessage(e));
    } finally {
      ui.hideLoading();
    }
  };

  const validate = () =>
    ui.custom(
      close => (
        <VerifyEvidenceDialog
          document={document}
          technologyCode={technologyCode}
          onClose={close}
          onSubmit={async () => {
            close();
            ui.showLoading();
            try {
              const r = await app.api.validateEvidence({
                id: document.Id ?? 0,
                zedId: app.zedId,
                certificationType: document.CertificationType ?? '',
                isVerified: document.IsVerified ?? '',
                remarks: document.AssessorRemarks,
                sourceOfValidation: document.SourceOfValidation,
                attachments: document.uploadedAttachments ?? [],
              });
              ui.hideLoading();
              if (isSuccess(r)) {
                document.isValidateClicked = true;
                onValidated();
              } else {
                ui.showAlert(refusalMessage(r));
              }
            } catch (e) {
              ui.hideLoading();
              ui.showAlert(failureMessage(e));
            }
          }}
        />
      ),
      () => undefined,
    );

  const validateTitle = hasData || document.isValidateClicked ? 'Edit' : 'Validate';
  const validateEnabled = hasData || viewed || !!document.isValidateClicked;
  return (
    <Card style={styles.doc} testID={testID}>
      <View style={styles.docThumb}>
        {isPdf ? (
          <ZIcon name="document" size={26} color={C.danger} />
        ) : url ? (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <ZIcon name="image" size={24} color={C.primary} />
        )}
      </View>
      <View style={styles.flex}>
        <Text style={styles.docName} numberOfLines={2}>
          {document.Name ?? ''}
        </Text>
        <Text style={styles.docDate} numberOfLines={1}>{`captured at ${document.CreatedDate ?? ''}`}</Text>
        {document.isValidateClicked ? (
          <View style={styles.docBadge}>
            <Badge label="Validated" tone="success" small />
          </View>
        ) : null}
      </View>
      <View style={styles.docButtons}>
        <ZButton title="View" small variant="outline" onPress={view} style={styles.docButton} testID={`${testID}-view`} />
        <ZButton title={validateTitle} small onPress={validate} disabled={!validateEnabled} style={styles.docButton} testID={`${testID}-validate`} />
      </View>
    </Card>
  );
}

/** Two radio cards (the legacy YesNo): the first green, the second red when chosen; testIDs `${prefix}-${option}`. */
function TwoChoice({ label, options, value, onChange, testID }: { label: string; options: [string, string]; value: string | null; onChange: (v: string) => void; testID: string }) {
  return (
    <View style={styles.choiceBox} testID={testID}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choices}>
        {options.map((o, i) => {
          const on = value === o;
          const tone = i === 0 ? { fg: C.success, bg: C.successBg } : { fg: C.danger, bg: C.dangerBg };
          return (
            <Pressable
              key={o}
              style={[styles.choice, on && { borderColor: tone.fg, backgroundColor: tone.bg }, on && styles.choiceOn]}
              onPress={() => onChange(o)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              testID={`${testID}-${o}`}>
              <View style={[styles.radio, { borderColor: on ? tone.fg : C.border }]}>{on ? <View style={[styles.radioDot, { backgroundColor: tone.fg }]} /> : null}</View>
              <Text style={[styles.choiceText, on && { color: tone.fg }, on && styles.choiceTextOn]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A tick box with its label (the legacy CheckBox). */
function TickBox({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (c: boolean) => void; testID?: string }) {
  return (
    <Pressable style={styles.tickRow} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} testID={testID}>
      <View style={[styles.tick, checked && styles.tickOn]}>{checked ? <ZIcon name="check" size={14} color={C.tInverse} strokeWidth={2.6} /> : null}</View>
      <Text style={styles.tickLabel}>{label}</Text>
    </Pressable>
  );
}

/** TechUpgradationCertificateValidationFragment: "Verify Evidence". */
function VerifyEvidenceDialog({ document, technologyCode, onClose, onSubmit }: { document: FinancialAssistanceDocument; technologyCode: string; onClose: () => void; onSubmit: () => void }) {
  const app = useSa();
  const ui = useUi();
  const capturer = useSaPhotoCapture();
  const [verified, setVerified] = useState<string | null>(document.IsVerified ?? null);
  const [remarks, setRemarks] = useState(document.AssessorRemarks ?? '');
  const [attachments, setAttachments] = useState<PhotoData[]>(document.uploadedAttachments ?? []);
  const askAttachments = shouldAskForAttachments(document, technologyCode);
  return (
    <ZDialog title="Verify Evidence" onClose={onClose}>
      <View testID="verify-dialog">
        <TwoChoice label="VERIFIED" options={[YES, NO]} value={verified} onChange={setVerified} testID="verify-verified" />
        {askAttachments && verified === YES ? (
          <PhotosField label="Capture Evidences" photos={attachments} onChange={setAttachments} capturer={capturer} store={app.photos} maxPhotos={5} testID="verify-attachments" />
        ) : null}
        <Field label="Remarks" value={remarks} onChangeText={setRemarks} multiline maxLength={500} testID="verify-remarks" />
        <ZButton
          title="Submit"
          onPress={() => {
            document.IsVerified = verified;
            document.AssessorRemarks = remarks.trim() === '' ? null : remarks;
            document.uploadedAttachments = attachments as ConsultantPhoto[];
            if (!validateVerificationData(document, technologyCode)) return ui.snackbar(PLEASE_ENTER_DETAILS);
            onSubmit();
          }}
          testID="verify-submit"
        />
      </View>
    </ZDialog>
  );
}

/** RejectCommentFragment: "Confirm Final Submit". */
function RejectCommentDialog({ existing, onClose, onSubmit }: { existing: [boolean | null, string | null]; onClose: () => void; onSubmit: (accepted: boolean, comment: string) => void }) {
  const ui = useUi();
  const confirmText = useAppText('app.consultant.tu.dataCorrect.checkbox');
  const [response, setResponse] = useState<string | null>(existing[0] == null ? null : existing[0] ? YES : NO);
  const [comment, setComment] = useState(existing[1] ?? '');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <ZDialog title="Confirm Final Submit" onClose={onClose}>
      <View testID="final-submit-dialog">
        <TwoChoice
          label="PLEASE SELECT"
          options={['Accept', 'Reject']}
          value={response === YES ? 'Accept' : response === NO ? 'Reject' : null}
          onChange={v => setResponse(v === 'Accept' ? YES : NO)}
          testID="tu-decision"
        />
        <Field label="Comments" value={comment} onChangeText={t => (setComment(t), setCommentError(null))} error={commentError} multiline maxLength={500} testID="tu-comments" />
        <TickBox label={confirmText ? htmlToPlain(confirmText.html) : ''} checked={confirmed} onChange={setConfirmed} testID="tu-confirm" />
        <ZButton
          title="Submit"
          onPress={() => {
            if (response == null) return;
            if (comment.trim() === '') return setCommentError('Required');
            if (!confirmed) return ui.snackbar('Please confirm');
            onSubmit(response === YES, comment);
          }}
          style={styles.dialogSubmit}
          testID="tu-submit"
        />
      </View>
    </ZDialog>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: 12 },
  techRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  well: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  techName: { fontSize: 15, fontWeight: '700', color: C.tPrimary },
  techMeta: { flexDirection: 'row', marginTop: 6 },
  bigButton: { minHeight: 52, borderRadius: 12, marginTop: 12 },
  hint: { fontSize: 11, color: C.tMuted, textAlign: 'center', marginTop: 8 },
  summary: { paddingVertical: 6 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  summaryRule: { borderTopColor: C.divider, borderTopWidth: 1 },
  summaryLabel: { flex: 1, fontSize: 14, color: C.tPrimary, marginRight: 8 },
  summaryValue: { fontSize: 14, color: C.tPrimary },
  summaryHead: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.4 },
  summaryBold: { fontWeight: '700' },
  cardLabel: { fontSize: 12, fontWeight: '700', color: C.primaryDark },
  techTitle: { fontSize: 18, fontWeight: '700', color: C.tPrimary, marginTop: 4 },
  details: { paddingVertical: 4 },
  detail: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  detailDivider: { borderBottomColor: C.divider, borderBottomWidth: 1 },
  detailLabel: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.3 },
  detailValue: { fontSize: 15, color: C.tPrimary, marginTop: 2 },
  editIcon: { padding: 6 },
  doc: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  docThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginRight: 12 },
  docName: { fontSize: 14, fontWeight: '700', color: C.tPrimary },
  docDate: { fontSize: 11, color: C.tSecondary, marginTop: 2 },
  docBadge: { flexDirection: 'row', marginTop: 4 },
  docButtons: { gap: 6, marginLeft: 8 },
  docButton: { minWidth: 88 },
  dialog: { backgroundColor: C.surface, borderRadius: 16, padding: 18, margin: 20, maxHeight: '90%' },
  dialogHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: C.tPrimary },
  dialogButtons: { flexDirection: 'row', gap: 10 },
  dialogSubmit: { marginTop: 8 },
  choiceBox: { marginBottom: 14 },
  choiceLabel: { fontSize: 12, fontWeight: '600', color: C.tSecondary, marginBottom: 6 },
  choices: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  choiceText: { fontSize: 15, color: C.tPrimary },
  choiceOn: { borderWidth: 2 },
  choiceTextOn: { fontWeight: '700' },
  tickRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  tick: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.primary, borderColor: C.primary },
  tickLabel: { flex: 1, fontSize: 13, color: C.tPrimary, marginLeft: 10, lineHeight: 18 },
});
