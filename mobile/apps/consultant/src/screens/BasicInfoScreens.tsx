import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView } from 'react-native';
import {
  basicInfoValue,
  CustomFormField,
  isBasicInfoFieldShown,
  isFormChangedRefusal,
  isNetworkAvailable,
  isSuccess,
  stampFormAnswers,
  useFocusEffect,
  useNavigation,
  useRoute,
  useUi,
  validateBasicInformation,
  type FormDefinition,
  type FormField,
} from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { basicInfoSubmitted, submitBasicInformation } from '../flows/submissions';
import { CONSULTANT_BASIC_INFO, STANDARD_KEYS } from '../forms';
import {
  DATA_ERROR,
  DATA_SUBMITTED,
  NETWORK_SAVED_LOCALLY,
  newBasicInformation,
  normalizeBasicInformation,
  Status,
  stringStatus,
  updatedBasicInfoStatus,
  type BasicInfoParameter,
  type BasicInformation,
} from '../models';
import { MenuRow, NavigationFooter, PageTitle, SaFrame, StaticLabel, sa } from '../ui/kit';

function useForm(app: SaApp): FormDefinition {
  useSyncExternalStore(
    l => app.forms.subscribe(l),
    () => app.forms.getRevision(),
  );
  return app.forms.get(CONSULTANT_BASIC_INFO);
}

/** The draft (created the first time, as BasicInformationActivity.onCreate). */
function useBasicInformation(app: SaApp): BasicInformation {
  const d = app.details!;
  return useMemo(() => {
    if (d.saBasicInformation == null) d.saBasicInformation = newBasicInformation();
    return normalizeBasicInformation(d.saBasicInformation);
  }, [d]);
}

/** The sections that have fields to show (a section whose fields the Admin all disabled is left out). */
const shownSections = (def: FormDefinition) => def.sections.filter(s => def.fields.some(f => f.section === s.key));

/** A section's status (each group of the request keeps its own); an Admin section without a group keeps none. */
const groupOf = (info: BasicInformation, section: string) => (info as unknown as Record<string, BasicInfoParameter | undefined>)[section];

const STATUS_COLORS: Record<Status, string> = {
  [Status.TO_START]: sa.coolGrey,
  [Status.IN_PROGRESS]: sa.squash,
  [Status.COMPLETED]: sa.teal,
  [Status.SUBMITTED]: sa.teal,
};

/**
 * BasicInformationActivity: the nine groups (the sections of the Admin's form, docs/mobile/APP-FORMS.md
 * `consultant.basicInfo`) with their status; PROCEED once all are completed submits them (SubmitBasicInformation).
 */
export function BasicInformationScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const def = useForm(app);
  const info = useBasicInformation(app);
  const [, rerender] = useState(0);

  useEffect(() => {
    isNetworkAvailable()
      .then(online => (online ? app.forms.refresh(CONSULTANT_BASIC_INFO, () => app.api.getFormDefinition(CONSULTANT_BASIC_INFO)) : false))
      .catch(() => undefined);
    // onPause: the overall status is refreshed and saved.
    return () => {
      updatedBasicInfoStatus(info);
      app.update();
    };
  }, [app, info]);

  useFocusEffect(useCallback(() => rerender(x => x + 1), []));

  const sections = shownSections(def);
  const allCompleted = sections.every(s => groupOf(info, s.key)?.status.status === Status.COMPLETED);

  const onProceed = async () => {
    if (validateBasicInformation(def, info).size > 0) return ui.toast(DATA_ERROR);
    stampFormAnswers(def, info, STANDARD_KEYS);
    await app.update();
    info.status = Status.COMPLETED;
    if (await isNetworkAvailable()) {
      ui.showLoading();
      const r = await submitBasicInformation(app, info);
      ui.hideLoading();
      if (isSuccess(r)) {
        await basicInfoSubmitted(app);
        ui.toast(DATA_SUBMITTED);
        nav.pop();
      } else if (r.errorMessage) {
        ui.toast(r.errorMessage);
        if (isFormChangedRefusal(r.errorMessage)) await app.forms.refresh(CONSULTANT_BASIC_INFO, () => app.api.getFormDefinition(CONSULTANT_BASIC_INFO));
      }
    } else {
      ui.alert(
        'Alert',
        NETWORK_SAVED_LOCALLY,
        [
          {
            text: 'OK',
            onPress: async () => {
              info.status = Status.COMPLETED;
              await app.update();
              nav.pop();
            },
          },
        ],
        false,
      );
    }
  };

  return (
    <SaFrame title="Basic Information" testID="basic-information">
      <PageTitle>PARAMETERS</PageTitle>
      <ScrollView contentContainerStyle={{ padding: 5 }}>
        {sections.map(s => {
          const group = groupOf(info, s.key);
          const status = group?.status.status ?? Status.TO_START;
          return (
            <MenuRow
              key={s.key}
              label={s.label}
              status={stringStatus(group?.status ?? { status })}
              statusColor={STATUS_COLORS[status]}
              bordered
              onPress={() => {
                if (group) group.status.status = Status.IN_PROGRESS;
                nav.push('BasicInfoSection', { section: s.key });
              }}
              testID={`basic-section-${s.key}`}
            />
          );
        })}
      </ScrollView>
      <NavigationFooter onBack={() => nav.pop()} onProceed={onProceed} proceedDisabled={!allCompleted} testID="basic-footer" />
    </SaFrame>
  );
}

/** Sets the answer at a property path (`energyManagement.solar.unit`), creating the objects on the way. */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] == null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * The group's fragment (OccupationalSafetyFragment, EnergyManagementFragment, ...): its title, the fields with their
 * headings (StaticLabelHelper), BACK and PROCEED (the fields left empty are marked "Required"; valid -> completed).
 */
export function BasicInfoSectionScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ section: string }>();
  const def = useForm(app);
  const info = useBasicInformation(app);
  const section = def.sections.find(s => s.key === params.section);
  const fields = def.fields.filter(f => f.section === params.section);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [, rerender] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const setValue = (f: FormField, v: unknown) => {
    if (f.custom) info.customAnswers = { ...(info.customAnswers ?? {}), [f.key]: v };
    else setAtPath(info as unknown as Record<string, unknown>, f.key, v === '' ? null : v);
    if (errors.has(f.key)) {
      const e = new Map(errors);
      e.delete(f.key);
      setErrors(e);
    }
    rerender(x => x + 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => app.update(), 500);
  };

  const proceed = async () => {
    const sectionDef: FormDefinition = { ...def, fields };
    const e = validateBasicInformation(sectionDef, info);
    setErrors(e);
    if (e.size > 0) return;
    const group = groupOf(info, params.section);
    if (group) group.status.status = Status.COMPLETED;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await app.update();
    nav.pop();
  };

  return (
    <SaFrame title="Basic Information" testID="basic-info-section">
      <PageTitle>{section?.label ?? ''}</PageTitle>
      <ScrollView contentContainerStyle={{ padding: 5 }} keyboardShouldPersistTaps="handled">
        {fields.map(f => {
          if (!isBasicInfoFieldShown(def, info, f)) return null;
          return (
            <React.Fragment key={f.key}>
              {f.heading ? <StaticLabel label={f.heading} /> : null}
              <CustomFormField field={{ ...f, heading: null }} value={basicInfoValue(info, f) ?? ''} onChange={v => setValue(f, v)} error={errors.get(f.key) ?? null} testID={`field-${f.key}`} />
            </React.Fragment>
          );
        })}
      </ScrollView>
      <NavigationFooter onBack={() => nav.pop()} onProceed={proceed} testID="section-footer" />
    </SaFrame>
  );
}
