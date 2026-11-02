/**
 * FinancialAssistanceActivity (activities/incentives/financialassistance/*): Disclaimer, Instructions, MSME Profile,
 * the details (certificate, expenditure, account, with their uploads) and Success, in order (no swipe). The claim is
 * sent as the legacy FinAssistanceViewModel did: the four uploads (SubmitFinancialPhotos), then the data
 * (SubmitFinancialData). The server checks the unit has a completed certification and computes the eligible amount.
 */
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBox,
  colors,
  dimens,
  errorOf,
  HtmlText,
  htmlToPlain,
  isNetworkAvailable,
  isSuccess,
  OutlinedInput,
  PhotosField,
  RadioButton,
  ScreenFrame,
  shapes,
  textStyles,
  useAppText,
  useBackHandler,
  useNavigation,
  useUi,
  ZedButton,
  ZedDialog,
  zedDevice,
  type BaseServiceResponse,
  type PhotoData,
} from '@zed/shared';
import { useMsme } from '../app/context';
import { useScreenCapture } from '../components/capture';
import {
  accountIsValid,
  CATEGORIES,
  certificationIsValid,
  eligibleAmount,
  expenditureIsValid,
  financialAssistanceIsValid,
  newFinancialAssistance,
  type CertificationInfo,
  type ExpenditureInfo,
  type FinancialAssistance,
} from '../financialAssistance';
import { Footer } from './PasswordScreens';

const TITLES = ['Disclaimer', 'Instructions', 'MSME Profile', 'Certification Details', 'Financial Assistance'];
const REQUIRED_DATA = 'Please enter all the required data';
const PROCESSING_ERROR = 'Error occurred while while processing request, please try again';

export function FinancialAssistanceScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const [page, setPage] = useState(0);
  const claim = useRef<FinancialAssistance>(newFinancialAssistance(app.user?.MsmeDetails?.ZedId ?? app.loginId ?? '')).current;
  const [, rerender] = useState(0);
  const refresh = () => rerender(x => x + 1);
  const [dialog, setDialog] = useState<'certificate' | 'expenditure' | 'summary' | null>(null);
  const [declared, setDeclared] = useState(false);

  useBackHandler(() => {
    if (ui.isLoading) return true;
    if (page === 0 || page === 4) return false;
    setPage(p => p - 1);
    return true;
  });

  const submit = async () => {
    setDialog(null);
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    const steps: [string, PhotoData[]][] = [
      ['certification photos', claim.CertificationDetails.Photos],
      ['expenditure certificate photos', claim.ExpenditureDetails.Photos],
      ['expenditure invoice photos', claim.ExpenditureDetails.InvoicePhotos],
      ['cancelled cheque photos', claim.AccountDetails.Photos],
    ];
    ui.showLoading();
    try {
      for (const [what, photos] of steps) {
        const r = await app.api.submitFinancialPhotos(claim.ZedId, photos);
        if (!isSuccess(r)) return ui.showAlert(`Error occurred while submitting ${what}: ${errorOf(r)}`, 'Missing/Invalid Data');
      }
      const r: BaseServiceResponse = await app.api.submitFinancialData(claim);
      if (!isSuccess(r)) return ui.showAlert(`Error occurred while submitting basic info: ${errorOf(r)}`, 'Missing/Invalid Data');
      setPage(4);
    } catch (e) {
      ui.showAlert(e instanceof Error && e.message ? e.message : PROCESSING_ERROR);
    } finally {
      ui.hideLoading();
    }
  };

  return (
    <ScreenFrame title={TITLES[page] ?? 'Financial Assistance'} testID="financial-assistance">
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID={`fa-page-${page}`}>
        {page >= 2 && page <= 3 ? <Dots current={page - 1} /> : null}
        {page === 0 ? <TextPage textKey="app.msme.schemes.fa.disclaimer" onBack={() => nav.pop()} onProceed={() => setPage(1)} /> : null}
        {page === 1 ? <TextPage textKey="app.msme.schemes.fa.instructions" onBack={() => setPage(0)} onProceed={() => setPage(2)} /> : null}
        {page === 2 ? <Profile onBack={() => setPage(1)} onProceed={() => setPage(3)} /> : null}
        {page === 3 ? (
          <Details
            claim={claim}
            refresh={refresh}
            declared={declared}
            onDeclare={setDeclared}
            onCertificate={() => setDialog('certificate')}
            onExpenditure={() =>
              certificationIsValid(claim.CertificationDetails) ? setDialog('expenditure') : ui.snackbar('Please provide Certification Details first')
            }
            onBack={() => setPage(2)}
            onProceed={() => (financialAssistanceIsValid(claim) ? setDialog('summary') : ui.snackbar(REQUIRED_DATA))}
          />
        ) : null}
        {page === 4 ? (
          <View testID="fa-success">
            <Text style={styles.success}>Application for Financial Assistance submitted successfully!</Text>
            <ZedButton title="Done" onPress={() => nav.pop()} testID="fa-done" />
          </View>
        ) : null}
      </ScrollView>
      {dialog === 'certificate' ? (
        <CertificateDialog
          info={claim.CertificationDetails}
          onClose={() => setDialog(null)}
          onDone={info => {
            claim.CertificationDetails = { ...info, CategoryOfCertificate: claim.CertificationDetails.CategoryOfCertificate };
            // The expenditure repeats the certificate's name and agency.
            claim.ExpenditureDetails.ExpenditureCertficate = info.NameOfCertficate;
            claim.ExpenditureDetails.AgencyOrSupplier = info.CertificationAgency;
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === 'expenditure' ? (
        <ExpenditureDialog
          info={claim.ExpenditureDetails}
          certificate={claim.CertificationDetails}
          onClose={() => setDialog(null)}
          onDone={info => {
            claim.ExpenditureDetails = info;
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === 'summary' ? (
        <ZedDialog visible title="Summary" onClose={() => setDialog(null)} testID="fa-summary">
          <Row label="Amount Paid (Rs.)" value={claim.ExpenditureDetails.AmountPaid} />
          <Row label="Financial Assistance Eligible Amount" value={claim.ExpenditureDetails.EligibleAmount} />
          <ZedButton title="Done" onPress={submit} style={{ marginTop: dimens.padding2 }} testID="fa-submit" />
        </ZedDialog>
      ) : null}
    </ScreenFrame>
  );
}

function Dots({ current }: { current: number }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3].map(i => (
        <View key={i} style={[styles.dot, i < current && styles.dotDone, i === current && styles.dotCurrent]} />
      ))}
    </View>
  );
}

/** FinAssistanceDisclaimerFragment / FinAssistanceInstructionsFragment: the Admin text and "Accept & Proceed". */
function TextPage({ textKey, onBack, onProceed }: { textKey: string; onBack: () => void; onProceed: () => void }) {
  const text = useAppText(textKey);
  return (
    <View>
      {text ? <HtmlText html={text.html} style={styles.body} /> : null}
      <Footer onBack={onBack} onProceed={onProceed} proceedTitle="Accept & Proceed" />
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value ?? ''}</Text>
    </View>
  );
}

/** MsmeProfileFragment: the unit's details, read only. */
function Profile({ onBack, onProceed }: { onBack: () => void; onProceed: () => void }) {
  const app = useMsme();
  const m = app.user?.MsmeDetails;
  const b = m?.BasicDetails;
  const rows: [string, string | null | undefined][] = [
    ['ZED ID', m?.ZedId],
    ['Udyam No', b?.UdyogAadharNo],
    ['Owner Name', b?.OwnerName],
    ['Enterprise Name', b?.EnterpriseName],
    ['Enterprise Type', b?.EnterpriseTypee ?? b?.EnterpriseType],
    ['Organization Type', b?.OrganisationTypeName ?? b?.OrganisationType],
    ['Social Category', b?.SocialCategoryName ?? b?.SocialCategory],
    ['Gender', b?.Gender],
    ['Email ID', b?.EmailId],
    ['Mobile No', b?.MobileNo],
    ['Physically Handicapped', b?.PH],
    ['PAN No', b?.PanNo],
    ['Registered Address', b?.Address],
    ['State', b?.state_name],
    ['District', b?.DISTRICT_NAME],
    ['Pincode', b?.PINCode],
    ['Major Activity', b?.MajorActivityName ?? b?.MajorActivity],
    ['Incorporation Date', b?.IncorporationDate],
    ['Whether Production Commenced', b?.WhetherProdCommenced],
    ['Commencement Date', b?.CommmenceDate],
    ['Total Employee', b?.TotalEmp],
    ['DIC Name', b?.Dic_Name],
    ['Applied Date', b?.AppliedDate],
  ];
  return (
    <View testID="fa-profile">
      <View style={styles.box}>
        {rows.map(([k, v]) => (
          <Row key={k} label={k} value={v} />
        ))}
      </View>
      <Footer onBack={onBack} onProceed={onProceed} />
    </View>
  );
}

/** FinAssistanceDetailsFragment. */
function Details({
  claim,
  refresh,
  declared,
  onDeclare,
  onCertificate,
  onExpenditure,
  onBack,
  onProceed,
}: {
  claim: FinancialAssistance;
  refresh: () => void;
  declared: boolean;
  onDeclare: (v: boolean) => void;
  onCertificate: () => void;
  onExpenditure: () => void;
  onBack: () => void;
  onProceed: () => void;
}) {
  const app = useMsme();
  const capturer = useScreenCapture('snackbar');
  const declaration = useAppText('app.msme.schemes.fa.accountDeclaration.checkbox');
  const c = claim.CertificationDetails;
  const e = claim.ExpenditureDetails;
  const a = claim.AccountDetails;
  const set = (change: () => void) => {
    change();
    refresh();
  };
  return (
    <View>
      <Text style={styles.heading}>Category of Certificate</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {CATEGORIES.map(k => (
          <RadioButton key={k} label={k} selected={c.CategoryOfCertificate === k} onPress={() => set(() => (c.CategoryOfCertificate = k))} testID={`fa-category-${k}`} />
        ))}
      </View>

      <Text style={styles.heading}>Certificate Details</Text>
      <Entry
        filled={certificationIsValid({ ...c, CategoryOfCertificate: c.CategoryOfCertificate ?? 'x' })}
        summary={`${c.NameOfCertficate ?? ''} · ${c.CertficateNumber ?? ''}`}
        onPress={onCertificate}
        testID="fa-certificate"
      />

      <Text style={styles.heading}>Details of Expenditure</Text>
      <Entry filled={expenditureIsValid(e)} summary={`Invoice ${e.InvoiceNo ?? ''} · Rs. ${e.AmountPaid ?? ''}`} onPress={onExpenditure} testID="fa-expenditure" />

      <Text style={styles.heading}>Account Details for Reimbursement</Text>
      <Field label="Account No." value={a.AccountNo} numeric onChange={v => set(() => (a.AccountNo = v))} testID="fa-account-no" />
      <Field label="IFSC Code" value={a.IfscCode} caps onChange={v => set(() => (a.IfscCode = v))} testID="fa-ifsc" />
      <Field label="Bank Name" value={a.BankName} onChange={v => set(() => (a.BankName = v))} testID="fa-bank" />
      <Field label="Branch Address" value={a.BranchAddress} multiline onChange={v => set(() => (a.BranchAddress = v))} testID="fa-branch" />
      <PhotosField
        label="Cancelled Cheque"
        photos={a.Photos}
        onChange={l => set(() => (a.Photos = l))}
        capturer={capturer}
        store={app.photos}
        allowPick
        testID="fa-cheque"
      />
      <CheckBox label={declaration ? htmlToPlain(declaration.html) : ''} checked={declared} onChange={onDeclare} testID="fa-declare" />
      <Footer onBack={onBack} onProceed={onProceed} proceedEnabled={declared} />
      {accountIsValid(a) ? null : <Text style={styles.note}>Account details and the cancelled cheque are required.</Text>}
    </View>
  );
}

function Entry({ filled, summary, onPress, testID }: { filled: boolean; summary: string; onPress: () => void; testID: string }) {
  return (
    <Pressable style={[styles.box, styles.entry]} onPress={onPress} testID={testID}>
      <Text style={filled ? styles.body : styles.add}>{filled ? summary : '+ Add'}</Text>
      {filled ? <Text style={styles.add}>Edit</Text> : null}
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric,
  caps,
  multiline,
  editable = true,
  testID,
}: {
  label: string;
  value?: string | null;
  onChange?: (v: string) => void;
  numeric?: boolean;
  caps?: boolean;
  multiline?: boolean;
  editable?: boolean;
  testID?: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <OutlinedInput
        value={value ?? ''}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        autoCapitalize={caps ? 'characters' : 'sentences'}
        multiline={multiline}
        editable={editable}
        testID={testID}
      />
    </View>
  );
}

function DateField({ label, value, onChange, testID }: { label: string; value?: string | null; onChange: (v: string) => void; testID: string }) {
  const pick = async () => {
    const d = await zedDevice().pickDate(value ?? null);
    if (d) onChange(d);
  };
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <OutlinedInput value={value ?? ''} editable={false} onPress={pick} placeholder="yyyy-MM-dd" testID={testID} />
    </View>
  );
}

/** CertificationDetailsFragment ("Add Certificate Details"). */
function CertificateDialog({ info, onClose, onDone }: { info: CertificationInfo; onClose: () => void; onDone: (i: CertificationInfo) => void }) {
  const app = useMsme();
  const ui = useUi();
  const capturer = useScreenCapture('snackbar');
  const [c, setC] = useState<CertificationInfo>({ ...info, Photos: [...info.Photos] });
  const set = (k: keyof CertificationInfo) => (v: string) => setC(x => ({ ...x, [k]: v }));
  return (
    <ZedDialog visible title="Add Certificate Details" onClose={onClose} testID="fa-certificate-dialog">
      <Field label="Name of Certificate" value={c.NameOfCertficate} onChange={set('NameOfCertficate')} testID="fa-cert-name" />
      <Field label="Name of Certification Agency" value={c.CertificationAgency} onChange={set('CertificationAgency')} testID="fa-cert-agency" />
      <Field label="Certificate Number" value={c.CertficateNumber} onChange={set('CertficateNumber')} testID="fa-cert-number" />
      <DateField label="Date of Issue of Certificate" value={c.DateOfIssue} onChange={set('DateOfIssue')} testID="fa-cert-date" />
      <Field label="Period of Validity of Certificate" value={c.ValidityOfCertificate} onChange={set('ValidityOfCertificate')} testID="fa-cert-validity" />
      <PhotosField
        label="Upload of Copy of Certificate"
        photos={c.Photos}
        onChange={l => setC(x => ({ ...x, Photos: l }))}
        capturer={capturer}
        store={app.photos}
        allowPick
        testID="fa-cert-copy"
      />
      <ZedButton
        title="Done"
        onPress={() => (certificationIsValid({ ...c, CategoryOfCertificate: 'x' }) ? onDone(c) : ui.toast(REQUIRED_DATA, { long: true }))}
        testID="fa-cert-done"
      />
    </ZedDialog>
  );
}

/** ExpenditureDetailsFragment ("Add Expenditure Details"). */
function ExpenditureDialog({
  info,
  certificate,
  onClose,
  onDone,
}: {
  info: ExpenditureInfo;
  certificate: CertificationInfo;
  onClose: () => void;
  onDone: (i: ExpenditureInfo) => void;
}) {
  const app = useMsme();
  const ui = useUi();
  const capturer = useScreenCapture('snackbar');
  const [e, setE] = useState<ExpenditureInfo>({
    ...info,
    ExpenditureCertficate: certificate.NameOfCertficate,
    AgencyOrSupplier: certificate.CertificationAgency,
    Photos: [...info.Photos],
    InvoicePhotos: [...info.InvoicePhotos],
  });
  const set = (k: keyof ExpenditureInfo) => (v: string) => setE(x => ({ ...x, [k]: v }));
  return (
    <ZedDialog visible title="Add Expenditure Details" onClose={onClose} testID="fa-expenditure-dialog">
      <Field label="Name of Certificate" value={e.ExpenditureCertficate} editable={false} />
      <Field label="Name of Agency/Supplier" value={e.AgencyOrSupplier} editable={false} />
      <Field label="Invoice/Bill No." value={e.InvoiceNo} onChange={set('InvoiceNo')} testID="fa-invoice-no" />
      <DateField label="Invoice/Bill Date" value={e.InvoiceBillDate} onChange={set('InvoiceBillDate')} testID="fa-invoice-date" />
      <Field label="Description of Expenses" value={e.DescriptionOfExpenses} onChange={set('DescriptionOfExpenses')} testID="fa-description" />
      <Text style={styles.note}>Eligible Financial Assistance: 75% of invoice amount and max. up to 50,000 only</Text>
      <Field
        label="Amount Paid (Rs.)"
        value={e.AmountPaid}
        numeric
        onChange={v => setE(x => ({ ...x, AmountPaid: v.replace(/[^\d.]/g, ''), EligibleAmount: eligibleAmount(v.replace(/[^\d.]/g, '')) }))}
        testID="fa-amount"
      />
      <Field label="Mode of Payment" value={e.ModeOfPayment} onChange={set('ModeOfPayment')} testID="fa-mode" />
      <PhotosField
        label="CA certificate of expenditure"
        photos={e.Photos}
        onChange={l => setE(x => ({ ...x, Photos: l }))}
        capturer={capturer}
        store={app.photos}
        allowPick
        testID="fa-ca-certificate"
      />
      <PhotosField
        label="Invoice"
        photos={e.InvoicePhotos}
        onChange={l => setE(x => ({ ...x, InvoicePhotos: l }))}
        capturer={capturer}
        store={app.photos}
        allowPick
        testID="fa-invoice"
      />
      <ZedButton title="Done" onPress={() => (expenditureIsValid(e) ? onDone(e) : ui.toast(REQUIRED_DATA, { long: true }))} testID="fa-expenditure-done" />
    </ZedDialog>
  );
}

const styles = StyleSheet.create({
  page: { padding: dimens.padding2, backgroundColor: colors.white, flexGrow: 1 },
  body: { color: colors.black, fontSize: dimens.textSize14 },
  heading: { ...textStyles.defaultLabel, color: colors.appColorDark, fontWeight: 'bold', marginTop: dimens.padding3 },
  label: { ...textStyles.defaultLabel, marginTop: dimens.padding2 },
  note: { color: colors.labelColor, fontSize: dimens.textSize14, marginVertical: dimens.padding1 },
  add: { color: colors.appColorDark, fontWeight: 'bold' },
  box: { ...shapes.lightGreyOutlineFilled, padding: dimens.padding2, marginTop: dimens.padding1 },
  entry: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.lightGrey },
  rowLabel: { width: 150, color: colors.labelColor, fontSize: dimens.textSize14 },
  rowValue: { flex: 1, color: colors.black, fontSize: dimens.textSize14, fontWeight: 'bold' },
  success: { fontSize: 18, fontWeight: 'bold', color: colors.appColorDark, textAlign: 'center', marginVertical: dimens.padding4 },
  dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: dimens.padding2 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 4, backgroundColor: colors.labelColor, opacity: 0.4 },
  dotDone: { backgroundColor: colors.appColor, opacity: 0.6 },
  dotCurrent: { backgroundColor: colors.appColor, opacity: 1 },
});
