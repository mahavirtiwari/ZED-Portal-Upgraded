import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBox,
  FieldBox,
  FieldLabel,
  htmlToPlain,
  Icon,
  isSuccess,
  OutlinedInput,
  PhotosField,
  TextField,
  useAppText,
  useBackHandler,
  useNavigation,
  useUi,
  YesNo,
  zedDevice,
  type PhotoData,
} from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { icons } from '../assets/icons';
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
import { DialogFrame, Divider, MenuRow, PageTitle, ReviewItem, SaButton, SaFrame, StaticLabel, sa } from '../ui/kit';

const DOCUMENTS_VALIDATION_ERROR = 'Please validate all the documents';

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

function ReadOnlyField({ label, value, onEdit, testID }: { label: string; value: string; onEdit?: () => void; testID?: string }) {
  return (
    <FieldBox testID={testID}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value}
        editable={false}
        testID={testID ? `${testID}-value` : undefined}
        right={
          onEdit ? (
            <Text onPress={onEdit} style={{ padding: 8 }} testID={testID ? `${testID}-edit` : undefined}>
              <Icon icon={icons.ic_baseline_edit_24} size={24} />
            </Text>
          ) : undefined
        }
      />
    </FieldBox>
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

  useBackHandler(() => {
    if (selected) {
      setSelected(null);
    } else {
      ui.alert('Alert', 'Any changes you made will not be saved, would you like to proceed?', [
        { text: 'Yes', onPress: () => nav.pop() },
        { text: 'No', style: 'cancel' },
      ]);
    }
    return true;
  });

  if (!data) return <SaFrame testID="technology-upgradation">{null}</SaFrame>;

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
    <SaFrame testID="technology-upgradation">
      {selected ? (
        <TechnologyDetailsView app={app} data={data} cert={cert} technology={selected} onDone={() => (setSelected(null), refresh())} onValidated={refresh} />
      ) : (
        <TechnologiesList app={app} data={data} cert={cert} onSelect={setSelected} onFinalSubmission={onFinalSubmission} onValidated={refresh} />
      )}
    </SaFrame>
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
  return (
    <ScrollView contentContainerStyle={{ padding: 8 }}>
      <PageTitle>Technologies</PageTitle>
      {items.map((t, i) => (
        <MenuRow
          key={`${t.Id}-${i}`}
          label={t.TechnologyName ?? ''}
          status={t.isCompleted ? 'Completed' : 'Not Completed'}
          statusColor={t.isCompleted ? sa.teal : undefined}
          statusBold={t.isCompleted}
          onPress={() => onSelect(t)}
          testID={`tu-tech-${i}`}
        />
      ))}
      {certificate ? <DocumentRow app={app} document={certificate} technologyCode="" onValidated={onValidated} testID="tu-certificate" /> : null}
      <StaticLabel label="Financial Details" />
      {cheque ? <DocumentRow app={app} document={cheque} technologyCode="" onValidated={onValidated} testID="tu-cheque" /> : null}
      <Summary data={data} cert={cert} items={items} />
      <SaButton title="Final Submission" large disabled={!enabled} onPress={onFinalSubmission} testID="tu-final-submission" />
    </ScrollView>
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
      <StaticLabel label="Summary" />
      <View style={styles.summary} testID="tu-summary">
        <SummaryRow label="Name of Technology" value="Amount (Rs.)" bold />
        <Divider style={{ marginVertical: 2 }} />
        {accepted.map((t, i) => (
          <SummaryRow key={`${t.Id}-${i}`} label={t.TechnologyName ?? ''} value={twoDecimals(t.AmountPaid) ?? ''} />
        ))}
        <Divider style={{ marginVertical: 2 }} />
        <SummaryRow label="Total Amount" value={twoDecimals(total) ?? ''} bold />
        <Divider style={{ marginVertical: 2 }} />
        {/* The legacy showed a fixed 300000.00 above the maximum, whatever the maximum was. */}
        <SummaryRow label="Technology Support Eligible Amount" value={eligible <= maxSubsidy ? (twoDecimals(eligible) ?? '') : '300000.00'} bold />
      </View>
    </View>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, bold && { fontWeight: 'bold' }]}>{label}</Text>
      <Text style={[styles.summaryValue, bold && { fontWeight: 'bold' }]}>{value}</Text>
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

  return (
    <ScrollView contentContainerStyle={{ padding: 8 }}>
      <Text style={styles.subheading}>Technology Details</Text>
      <Text style={styles.subheading} testID="tu-tech-title">
        {t.TechnologyName ?? ''}
      </Text>
      {technologyRows(t).map(([label, value]) => (
        <ReadOnlyField key={label} label={label} value={value} />
      ))}
      {t.AmountPaid != null ? <ReadOnlyField label="Amount Paid before GST (Rs.)" value={amount} onEdit={editAmount} testID="tu-amount" /> : null}
      {t.ModeOfPayment != null ? <ReadOnlyField label="Mode of Payment" value={t.ModeOfPayment} /> : null}
      {purchased ? <DocumentRow app={app} document={purchased} technologyCode={code} onValidated={onValidated} testID="tu-purchased" /> : null}
      {invoice ? <DocumentRow app={app} document={invoice} technologyCode={code} onValidated={onValidated} testID="tu-invoice" /> : null}
      <SaButton title="Proceed" large disabled={!validated} onPress={proceed} testID="tu-proceed" />
    </ScrollView>
  );
}

/** TextInputHelper.showInputAlert: "Enter Value" (numeric), OK / Cancel. */
function AmountDialog({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <View style={styles.amountDialog} testID="amount-dialog">
      <TextField label="Enter Value" value={value} onChange={setValue} numeric testID="amount-input" />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Text style={styles.dialogButton} onPress={() => onDone(null)} testID="amount-cancel">
          CANCEL
        </Text>
        <Text style={styles.dialogButton} onPress={() => onDone(value)} testID="amount-ok">
          OK
        </Text>
      </View>
    </View>
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
      const path = await zedDevice().downloadFile(url, photoId);
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

  const image = isPdf ? <Icon icon={icons.ic_baseline_picture_as_pdf_18} size={48} /> : url ? <Image source={{ uri: url }} style={{ width: 64, height: 64 }} resizeMode="contain" /> : undefined;
  return (
    <ReviewItem
      label={`${document.Name ?? ''}\ncaptured at ${document.CreatedDate ?? ''}`}
      imageNode={image}
      onView={view}
      validateTitle={hasData || document.isValidateClicked ? 'Edit' : 'Validate'}
      validateEnabled={hasData || viewed || !!document.isValidateClicked}
      onValidate={validate}
      testID={testID}
    />
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
    <DialogFrame title="Verify Evidence" onClose={onClose}>
      <View testID="verify-dialog">
        <YesNo label="Verified" value={verified} onChange={setVerified} testID="verify-verified" />
        {askAttachments && verified === YES ? (
          <PhotosField label="Capture Evidences" photos={attachments} onChange={setAttachments} capturer={capturer} store={app.photos} maxPhotos={5} testID="verify-attachments" />
        ) : null}
        <TextField label="Remarks" value={remarks} onChange={setRemarks} multiline testID="verify-remarks" />
        <SaButton
          title="Submit"
          style={{ alignSelf: 'flex-end' }}
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
    </DialogFrame>
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
    <DialogFrame title="Confirm Final Submit" onClose={onClose}>
      <View testID="final-submit-dialog">
        <YesNo
          label="Please select"
          value={response === YES ? 'Accept' : response === NO ? 'Reject' : null}
          onChange={v => setResponse(v === 'Accept' ? YES : NO)}
          yesLabel="Accept"
          noLabel="Reject"
          testID="tu-decision"
        />
        <TextField label="Comments" value={comment} onChange={t => (setComment(t), setCommentError(null))} error={commentError} multiline testID="tu-comments" />
        <CheckBox label={confirmText ? htmlToPlain(confirmText.html) : ''} checked={confirmed} onChange={setConfirmed} testID="tu-confirm" />
        <SaButton
          title="Submit"
          style={{ alignSelf: 'flex-end' }}
          onPress={() => {
            if (response == null) return;
            if (comment.trim() === '') return setCommentError('Required');
            if (!confirmed) return ui.snackbar('Please confirm');
            onSubmit(response === YES, comment);
          }}
          testID="tu-submit"
        />
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  subheading: { fontSize: 22, fontWeight: 'bold', color: sa.subheading, marginBottom: 8, marginTop: 5 },
  summary: { backgroundColor: sa.white, borderColor: '#C7CACD', borderWidth: 0.5, padding: 5 },
  summaryRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8 },
  summaryLabel: { flex: 1, color: sa.darkGrey, fontSize: 15 },
  summaryValue: { color: sa.darkGrey, fontSize: 15 },
  amountDialog: { backgroundColor: sa.white, borderRadius: 4, padding: 16, margin: 24 },
  dialogButton: { color: sa.primary, fontWeight: '500', fontSize: 14, paddingHorizontal: 12, paddingVertical: 8 },
});
