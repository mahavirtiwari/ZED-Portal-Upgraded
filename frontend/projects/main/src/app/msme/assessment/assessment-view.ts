import { AssessmentReport, NonConformanceReport, NonConformanceRound, Row } from './assessment.api';

/**
 * Display models for the two pages, built once per load instead of the old page's nested
 * `ng-repeat | filter:{...}:true` expressions. The rules follow BasicInfo.cshtml,
 * NonConformances.cshtml (Bronze, "da") and NonConformancesSa.cshtml (Silver/Gold, "sa").
 */

export interface FileItem {
  url: string | null;
  isPdf: boolean;
  timeStamp: unknown;
  createdDate: unknown;
}

export interface EvidenceItem {
  label: string;
  url: string | null;
  isPdf: boolean;
  generatedTime: unknown;
}

export interface OptionView {
  option: Row;
  subOptions: Row[];
}

export interface RequirementView {
  requirement: Row;
  options: OptionView[];
  evidences: Row[];
}

export interface SectionView {
  section: Row;
  requirements: RequirementView[];
}

export interface NcRequirementView {
  requirement: Row;
  options: OptionView[];
  /** What the NC was raised on: the desktop assessment's evidences (NC1) or the previous round's reply. */
  previous: EvidenceItem[];
  /** First column of the previous evidences ("w-50" with a name, "w-25" empty from NC2 on). */
  previousLabelWide: boolean;
  current: Row[];
  responded: boolean;
}

export interface NcSectionView {
  section: Row;
  requirements: NcRequirementView[];
}

export interface NcProductView {
  product: Row;
  previous: FileItem[];
  current: FileItem[];
  hasResponse: boolean;
}

export interface NcRoundView {
  number: number;
  /** Shown only when the round has site exterior photos. */
  siteExterior: {
    previous: FileItem[];
    assessor: Row;
    msme: Row;
    hasResponse: boolean;
    current: FileItem[];
  } | null;
  products: NcProductView[];
  sections: NcSectionView[];
}

const SITE_EXTERIOR = 'SiteExteriorPhotos';

/** AngularJS `filter:{...}:true` compared values strictly; the procedures mix numbers and text for codes. */
const same = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const url = (r: Row, field = 'FileUrl') => (typeof r[field] === 'string' && r[field] ? (r[field] as string) : null);

const ofRequirement = (rows: Row[], s: Row, r: Row) =>
  rows.filter((x) => same(x['SectionCode'], s['SectionCode']) && same(x['RequirementCode'], r['RequirementCode']));

function optionsOf(options: Row[], subOptions: Row[], s: Row, r: Row): OptionView[] {
  return ofRequirement(options, s, r).map((o) => ({
    option: o,
    subOptions: ofRequirement(subOptions, s, r).filter((so) => same(so['OptionCode'], o['OptionCode'])),
  }));
}

/** "Parameters / Document Uploaded" tab of the basic information page. */
export function basicInfoSections(report: AssessmentReport): SectionView[] {
  return report.sections.map((s) => ({
    section: s,
    requirements: report.requirements
      .filter((r) => same(r['SectionCode'], s['SectionCode']))
      .map((r) => ({
        requirement: r,
        options: optionsOf(report.options, report.subOptions, s, r),
        evidences: ofRequirement(report.evidences, s, r),
      })),
  }));
}

export const photosOfType = (photos: Row[], type: string) => photos.filter((p) => p['PhotoType'] === type);

/** MsmePhotos / SaPhotos rows: PDF when PhotoExtension is "pdf". */
const photoItem = (p: Row): FileItem => ({ url: url(p), isPdf: p['PhotoExtension'] === 'pdf', timeStamp: p['TimeStamp'], createdDate: p['CreatedDate'] });
/** Silver/Gold product photos (SaPhotos.Photo): PDF when the address contains "pdf". */
const productPhotoItem = (p: Row): FileItem => ({ url: url(p), isPdf: p['IsPdf'] === true, timeStamp: p['TimeStamp'], createdDate: p['CreatedDate'] });

/** NC1 ... NCn tabs. Round k is compared with the desktop assessment (k = 1) or round k - 1. */
export function nonConformanceRounds(report: NonConformanceReport): NcRoundView[] {
  const sa = report.variant === 'sa';
  const desktop = report.assessment;

  return report.rounds.map((cur, i) => {
    const prev: NonConformanceRound | null = i > 0 ? report.rounds[i - 1] : null;
    const prevPhotos = prev ? prev.photos : desktop.photos;

    const curExterior = photosOfType(cur.photos, SITE_EXTERIOR);
    const siteExterior = curExterior.length > 0
      ? {
          previous: photosOfType(prevPhotos, SITE_EXTERIOR).map(photoItem),
          // The old page showed the first photo row's assessor remarks, whatever its type.
          assessor: prevPhotos[0] ?? {},
          msme: curExterior[0],
          hasResponse: cur.photos.length > 0,
          current: curExterior.map(photoItem),
        }
      : null;

    const products = cur.products.map((prod) => {
      const previous = sa && prev
        ? prev.productPhotos.filter((p) => same(p['ProductParentId'], prod['ProductParentId'])).map(productPhotoItem)
        : prevPhotos.filter((p) => same(p['ProductId'], prod['ProductParentId'])).map(photoItem);
      const current = sa
        ? cur.productPhotos.filter((p) => same(p['ProductId'], prod['Id'])).map(productPhotoItem)
        : cur.photos.filter((p) => same(p['ProductId'], prod['Id'])).map(photoItem);
      return { product: prod, previous, current, hasResponse: (sa ? cur.productPhotos : cur.photos).length > 0 };
    });

    const sections = cur.sections.map((s) => ({
      section: s,
      requirements: cur.requirements
        .filter((r) => same(r['SectionCode'], s['SectionCode']))
        .map((r): NcRequirementView => {
          let previous: EvidenceItem[];
          if (sa && !prev) {
            // Silver/Gold NC1: the site assessment's evidence photos.
            previous = ofRequirement(report.saEvidencePhotos, s, r).map((e) => ({
              label: `${text(e['Name'])}-`, url: url(e), isPdf: e['IsPdf'] === true, generatedTime: e['GeneratedTime'],
            }));
          } else {
            previous = ofRequirement(prev ? prev.evidences : desktop.evidences, s, r).map((e) => ({
              label: prev ? '' : text(e['EvidenceName']), url: url(e), isPdf: true, generatedTime: e['GeneratedTime'],
            }));
          }
          return {
            requirement: r,
            options: optionsOf(cur.options, cur.subOptions, s, r),
            previous,
            previousLabelWide: !prev,
            current: ofRequirement(cur.evidences, s, r),
            responded: !!r['MsmeUpdatedDate'],
          };
        }),
    }));

    return { number: cur.number, siteExterior, products, sections };
  });
}
