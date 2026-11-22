import { DESKTOP_SCHEME_SUB_ROLE, ONSITE_SUB_ROLE, StaffMenuEntry, StaffMenuItem, StaffRole, homeFor, menuEntries, menuFor, menuScreenAllows, staffRoleName } from './staff-menu';
import { setAllLevels } from '../msme/shared/levels';

describe('staff menu', () => {
  const labels = (roleId: number, subRoles: string[]) => menuFor(roleId, subRoles).map((i) => i.label);

  it('shows agencies only the allotment screens of their sub-roles', () => {
    const desktopOnly = labels(StaffRole.Agency, ['DesktopVerification']);
    expect(desktopOnly).toContain('DA Allotment');
    expect(desktopOnly).not.toContain('SA Allotment');
    expect(desktopOnly).toContain('Monitoring');
    expect(desktopOnly).not.toContain('Financial Assistance');

    const none = labels(StaffRole.Agency, []);
    expect(none).not.toContain('Monitoring');
    expect(none).toContain('Assessors');
  });

  it('always shows assessors Completed, Non-Conformances and Rejected', () => {
    const l = labels(StaffRole.DesktopAssessor, []);
    expect(l).toEqual(expect.arrayContaining(['Completed', 'Non-Conformances', 'Rejected Certification']));
    expect(l).not.toContain('Desktop Verification');
  });

  it('gives state coordinators the NEFT screens and reports only', () => {
    expect(labels(StaffRole.StateCoordinator, ['DesktopVerification', 'SiteVerification', 'FinancialVerification'])).toEqual([
      'Reports',
      'NEFT: New Transactions',
      'NEFT: Approved Transactions',
      'NEFT: Rejected Transactions',
      'Documents',
    ]);
  });

  it('gives an unknown role nothing', () => {
    expect(menuFor(12, [])).toEqual([]);
  });

  describe('consultancy', () => {
    const c = (roleId: number, subRoles: string[]) => menuFor(roleId, subRoles, 'consultancy').map((i) => i.label);

    it('names the consultant and the CO as Consultancy calls them (2026-11-15: "Desktop Assessor, ZED Handholding")', () => {
      expect(staffRoleName({ roleId: 3, role: 'DesktopAssessor' }, 'consultancy')).toBe('Consultant/Expert');
      expect(staffRoleName({ roleId: 2, role: 'Agency' }, 'consultancy')).toBe('Consultant Organisation');
      expect(staffRoleName({ roleId: 3, role: 'DesktopAssessor' }, 'main')).toBe('Desktop Assessor');
      expect(staffRoleName({ roleId: 1, role: 'MasterAdmin' }, 'consultancy')).toBe('Master Admin');
      // 2026-11-16: sub-users by their own role: a Master Admin's are Operation Admins.
      expect(staffRoleName({ roleId: 7, role: 'MasterAdmin', actingUserId: 'MASTER1S01' }, 'main')).toBe('Operation Admin');
      expect(staffRoleName({ roleId: 2, role: 'Agency', actingUserId: 'AG1S01' }, 'main')).toBe('Agency Sub-User');
      expect(staffRoleName({ roleId: 2, role: 'Agency', actingUserId: 'CO1S01' }, 'consultancy')).toBe('Consultant Organisation Sub-User');
    });

    it('gives the master admin allotment, the CO and consultant lists and TU', () => {
      expect(c(StaffRole.MasterAdmin, [])).toEqual(expect.arrayContaining([
        'Allot Consultancy', 'Consultant Organisations', 'Consultants', 'Payment Received', 'Monitoring', 'Consultancy Completed',
        'Technology Upgradation',
      ]));
    });

    it('gives a CO the handholding screens with site verification and TU with financial verification', () => {
      const site = c(StaffRole.Agency, ['SiteVerification']);
      expect(site).toEqual(expect.arrayContaining(['Allot Consultancy', 'Consultancy Monitoring', 'Consultants/Experts', 'Reports']));
      expect(site).not.toContain('Technology Upgradation');
      expect(c(StaffRole.Agency, ['FinancialVerification'])).toEqual(['Consultants/Experts', 'Reports', 'Technology Upgradation', 'Expenditure', 'Documents', 'Quality Observations', 'Sub-Users']);
    });

    it('gives consultants the milestone lists, pointing at the site-assessment routes', () => {
      const items = menuFor(StaffRole.DesktopAssessor, ['SiteVerification'], 'consultancy');
      expect(items.filter((i) => i.label.startsWith('Milestone')).map((i) => i.route)).toEqual([
        '/staff/site-assessment/milestones/1', '/staff/site-assessment/milestones/2', '/staff/site-assessment/milestones/3',
      ]);
    });

    it('has no categories, technologies masters or legacy links', () => {
      const admin = c(StaffRole.Admin, []);
      expect(admin).toEqual(['All settings', 'Upload Image', 'Documents/Videos', 'Sectors', 'Payments', 'User Management', 'Captcha Settings', 'Email Settings', 'Professional Verification', 'Email Templates', 'Server Logs', 'Texts', 'App Forms']);
      expect(menuFor(StaffRole.MasterAdmin, [], 'consultancy').every((i) => i.route && !i.legacyPath)).toBe(true);
    });

    it('lands admins on the dashboard (no questionnaire here) and coordinators on NEFT', () => {
      expect(homeFor(StaffRole.Admin, 'consultancy')).toBe('/staff/dashboard');
      expect(homeFor(StaffRole.Admin, 'main')).toBe('/staff/dashboard');
      expect(homeFor(StaffRole.StateCoordinator, 'consultancy')).toBe('/staff/neft/new');
      expect(homeFor(StaffRole.Ministry, 'consultancy')).toBe('/staff/dashboard');
    });
  });

  describe('surveillance', () => {
    const s = (roleId: number, subRoles: string[]) => menuFor(roleId, subRoles, 'surveillance').map((i) => i.label);

    it('gives the master admin the surveillance screens and agency view', () => {
      expect(s(StaffRole.MasterAdmin, [])).toEqual(expect.arrayContaining([
        'Allot Surveillance', 'Assessment Agencies', 'Assessors', 'Surveillance Payment Received', 'Surveillance Monitoring',
        'Surveillance Completed', 'Surveillance Rejected',
      ]));
    });

    it('shows every assessor Completed and Non-Conformances, whatever the sub-role', () => {
      expect(s(StaffRole.DesktopAssessor, ['SiteVerification'])).toEqual(expect.arrayContaining(['Completed', 'Non-Conformances']));
      expect(s(StaffRole.DesktopAssessor, ['SiteVerification'])).not.toContain('Surveillance Assessments');
    });

    // 2026-11-19: a site-only (Silver / Gold surveillance) agency manages and blocks its assessors too.
    it('gives every surveillance agency its Assessors, and the master admin Operation Admins (agencies Sub-Users)', () => {
      expect(s(StaffRole.Agency, ['SiteVerification'])).toContain('Assessors');
      expect(s(StaffRole.Agency, ['DesktopVerification'])).toContain('Assessors');
      expect(s(StaffRole.Agency, ['SiteVerification'])).toContain('Sub-Users');
      expect(s(StaffRole.MasterAdmin, [])).toContain('Operation Admins');
    });

    it('splits agency allotment by sub-role and has no NEFT', () => {
      expect(s(StaffRole.Agency, ['DesktopVerification'])).toContain('Allot Surveillance');
      expect(s(StaffRole.Agency, ['DesktopVerification'])).not.toContain('Allot Surveillance (Site)');
      expect(s(StaffRole.StateCoordinator, [])).toEqual([]);
      expect(homeFor(StaffRole.Admin, 'surveillance')).toBe('/staff/dashboard');
      expect(homeFor(StaffRole.StateCoordinator, 'surveillance')).toBeNull();
    });
  });

  describe('menu bar drop-downs (the old layout grouped the long menus)', () => {
    const bar = (roleId: number, system: 'main' | 'consultancy' | 'surveillance') =>
      menuEntries(menuFor(roleId, [], system)).map((e: StaffMenuEntry) => ('group' in e ? `${e.group} (${e.items.length})` : e.item.label));

    it('groups the long menus into a few drop-downs (V4)', () => {
      expect(bar(StaffRole.MasterAdmin, 'main')).toEqual(['Agencies (5)', 'Assessment (6)', 'Schemes (4)', 'Expenditure', 'Documents', 'Quality Observations', 'Operation Admins']);
      expect(bar(StaffRole.Admin, 'main')).toEqual([
        'All settings', 'Master (7)', 'Questionnaire (5)', 'Technology Upgradation (2)', 'Incentives (6)', 'User Management', 'Administration (18)', 'Expenditure',
      ]);
      expect(bar(StaffRole.Admin, 'consultancy')).toEqual(['All settings', 'Master (4)', 'User Management', 'Administration (7)']);
      expect(bar(StaffRole.Admin, 'surveillance')).toEqual(['All settings', 'Master (2)', 'Questionnaire (5)', 'User Management', 'Administration (10)']);
      // The incentives in four groups, a page each (the state is chosen on the State Government page), and the MSME dashboard's cards.
      expect(menuFor(StaffRole.Admin, [], 'main').filter((i) => i.group === 'Incentives').map((i) => `${i.label} ${i.route}`)).toEqual([
        'Ministry of MSME /staff/incentives/ministry', 'State Government /staff/incentives/state',
        'Financial Institution /staff/incentives/financial', 'Others /staff/incentives/others',
        'Main Dashboard Cards /staff/incentives/dashboard-cards',
        'Incentive Schemes /staff/incentives/schemes',
      ]);
      expect(bar(StaffRole.MasterAdmin, 'consultancy')).toEqual(['Allot Consultancy', 'Consultancy Monitoring (6)', 'Technology Upgradation', 'Expenditure', 'Documents', 'Quality Observations', 'Operation Admins']);
      expect(bar(StaffRole.MasterAdmin, 'surveillance')).toEqual(['Allot Surveillance', 'Agencies (2)', 'Surveillance Monitoring (5)', 'Quality Observations', 'Operation Admins', 'Documents']);
    });

    it('puts the headings of a menu inside its drop-down', () => {
      const items: StaffMenuItem[] = [
        { label: 'A', route: '/a', roles: [1], menu: 'M' },
        { label: 'B', route: '/b', roles: [1], menu: 'M', group: 'H' },
        { label: 'C', route: '/c', roles: [1], menu: 'M', group: 'H' },
      ];
      const [m] = menuEntries(items);
      expect('sections' in m && m.sections.map((x) => `${x.heading ?? '-'} (${x.items.length})`)).toEqual(['- (1)', 'H (2)']);
    });

    it('groups the agencies\' lists; a drop-down with one screen is a plain link', () => {
      const agency = (system: 'main' | 'consultancy' | 'surveillance') =>
        menuEntries(menuFor(StaffRole.Agency, ['DesktopVerification', 'SiteVerification', 'FinancialVerification'], system)).map((e: StaffMenuEntry) =>
          'group' in e ? `${e.group} (${e.items.length})` : e.item.label);
      // 2026-11-20: an assessment agency no longer verifies incentive schemes (no "Schemes" drop-down).
      expect(agency('main')).toEqual(['Reports', 'Assessment (3)', 'Assessors', 'Allotment (2)', 'Financial Assistance', 'Expenditure', 'Documents', 'Quality Observations', 'Sub-Users']);
      expect(agency('surveillance')).toEqual(['Surveillance (3)', 'Assessors', 'Allotment (2)', 'Reports', 'Quality Observations', 'Sub-Users', 'Documents']);
      expect(agency('consultancy')).toEqual(['Consultancy (3)', 'Consultants/Experts', 'Reports', 'Technology Upgradation', 'Expenditure', 'Documents', 'Quality Observations', 'Sub-Users']);
      // An agency with only desktop verification has one allotment screen: a link, not a drop-down.
      expect(menuEntries(menuFor(StaffRole.Agency, ['DesktopVerification'], 'main')).some((e) => 'item' in e && e.item.label === 'DA Allotment')).toBe(true);
      expect(menuEntries(menuFor(StaffRole.DesktopAssessor, ['DesktopVerification', 'SiteVerification'], 'main')).every((e) => 'item' in e)).toBe(true);
    });
  });
  describe('onsite verification agencies (2026-11-20, incentive schemes phase 2)', () => {
    it('gives an onsite agency only its assessors, sub-users and the scheme onsite allotment and QC', () => {
      expect(labels(StaffRole.Agency, [ONSITE_SUB_ROLE])).toEqual(['Assessors', 'Scheme Onsite Allotment', 'Scheme Onsite QC', 'Sub-Users']);
      expect(menuFor(StaffRole.Agency, [ONSITE_SUB_ROLE]).map((i) => i.route)).toEqual([
        '/staff/users/my-assessors', '/staff/scheme-onsite/allotment', '/staff/scheme-onsite/qc', '/staff/sub-users',
      ]);
    });

    it('keeps the onsite screens away from the assessment agencies, and the assessment screens away from onsite agencies', () => {
      const normal = labels(StaffRole.Agency, ['DesktopVerification', 'SiteVerification', 'FinancialVerification']);
      expect(normal).not.toContain('Scheme Onsite Allotment');
      expect(normal).not.toContain('Scheme Onsite QC');
      // 2026-11-20 (the product owner): the assessment agencies and their assessors no longer verify incentive schemes.
      expect(normal).not.toContain('Scheme Allotment');
      expect(normal).not.toContain('Scheme QC');
      expect(labels(StaffRole.DesktopAssessor, ['DesktopVerification', 'SiteVerification'])).not.toContain('Scheme Verification');
      const onsite = labels(StaffRole.Agency, [ONSITE_SUB_ROLE]);
      for (const l of ['DA Allotment', 'SA Allotment', 'Monitoring', 'Scheme Allotment', 'Scheme QC', 'Reports', 'Expenditure', 'Financial Assistance']) expect(onsite).not.toContain(l);
      // Its assessors verify in the assessor app: no assessment screen on the web.
      expect(labels(StaffRole.DesktopAssessor, [ONSITE_SUB_ROLE])).toEqual([]);
    });

    it('gives the master admin the Incentive Verification Agencies page under Schemes', () => {
      const schemes = menuFor(StaffRole.MasterAdmin, []).filter((i) => i.group === 'Schemes');
      expect(schemes.map((i) => `${i.label} ${i.route}`)).toContain('Incentive Verification Agencies /staff/scheme-agencies');
      expect(schemes.map((i) => i.label)).not.toContain('Onsite Verification Agencies');
      // A sub-user of an onsite agency given the onsite screens.
      expect(menuFor(StaffRole.Agency, [ONSITE_SUB_ROLE], 'main', ['/staff/scheme-onsite/allotment', '/staff/scheme-onsite/qc']).map((i) => i.label))
        .toEqual(['Scheme Onsite Allotment', 'Scheme Onsite QC']);
    });
  });

  describe('desktop verification agencies (2026-11-20, the product owner)', () => {
    it('gives a desktop agency only its assessors, sub-users and the scheme allotment and QC', () => {
      expect(labels(StaffRole.Agency, [DESKTOP_SCHEME_SUB_ROLE])).toEqual(['Assessors', 'Scheme Allotment', 'Scheme QC', 'Sub-Users']);
      expect(menuFor(StaffRole.Agency, [DESKTOP_SCHEME_SUB_ROLE]).map((i) => i.route)).toEqual([
        '/staff/users/my-assessors', '/staff/schemes-verify/allotment', '/staff/schemes-verify/qc', '/staff/sub-users',
      ]);
      const desktop = labels(StaffRole.Agency, [DESKTOP_SCHEME_SUB_ROLE]);
      for (const l of ['DA Allotment', 'SA Allotment', 'Monitoring', 'Scheme Onsite Allotment', 'Scheme Onsite QC', 'Reports', 'Expenditure', 'Financial Assistance'])
        expect(desktop).not.toContain(l);
    });

    it('gives its assessors only Scheme Verification (on the web; no assessor app)', () => {
      expect(labels(StaffRole.DesktopAssessor, [DESKTOP_SCHEME_SUB_ROLE])).toEqual(['Scheme Verification']);
      // A sub-user of a desktop agency given the scheme screens.
      expect(menuFor(StaffRole.Agency, [DESKTOP_SCHEME_SUB_ROLE], 'main', ['/staff/schemes-verify/allotment']).map((i) => i.label)).toEqual(['Scheme Allotment']);
    });
  });

  describe('sub-users', () => {
    it('get only the screens their owner gave them, without user management', () => {
      // Documents: every sub-user (asserted below).
      const labels = (role: number, subs: string[], routes: string[], system: 'main' | 'consultancy' | 'surveillance' = 'main') =>
        menuFor(role, subs, system, routes).map((i) => i.label).filter((l) => l !== 'Documents');
      expect(labels(StaffRole.MasterAdmin, [], ['/staff/assessment/allot', '/staff/assessment/completed', '/staff/assessment/rejected'])).toEqual([
        'Allot Assessment', 'Assessment Completed', 'Rejected Certification',
      ]);
      expect(labels(StaffRole.Agency, ['DesktopVerification'], ['/staff/users/my-assessors', '/staff/users/assessors'])).toEqual(['Assessors']);
      expect(labels(StaffRole.Agency, ['DesktopVerification'], [])).toEqual([]);
      // Owners keep the whole menu.
      expect(menuFor(StaffRole.Agency, ['DesktopVerification'], 'main', null).map((i) => i.label)).toContain('Sub-Users');
    });

    it('all get the ZED team documents, not a limited dashboard login (2026-11-22)', () => {
      for (const system of ['main', 'consultancy', 'surveillance'] as const) {
        expect(menuFor(StaffRole.Agency, ['SiteVerification'], system, []).map((i) => i.label)).toEqual(['Documents']);
        expect(menuFor(StaffRole.MasterAdmin, [], system, []).map((i) => i.label)).toEqual(['Documents']);
      }
      expect(menuFor(StaffRole.SuperAdmin, [], 'main', ['/staff/reports']).map((i) => i.label)).not.toContain('Documents');
    });
  });
  it('reaches Customer History from Registered MSMEs; only logins without that list keep the menu item', () => {
    const has = (role: number, system: 'main' | 'consultancy' | 'surveillance', label: string) => menuFor(role, [], system).some((i) => i.label === label);
    for (const role of [StaffRole.SuperAdmin, StaffRole.CitizenFeedback, StaffRole.QC]) {
      expect(has(role, 'main', 'Customer History')).toBe(false);
      expect(has(role, 'main', 'Registered MSMEs')).toBe(true);
    }
    expect([has(StaffRole.SuperAdmin, 'consultancy', 'Customer History'), has(StaffRole.CitizenFeedback, 'consultancy', 'Customer History'), has(StaffRole.QC, 'consultancy', 'Customer History')])
      .toEqual([false, true, true]);
    expect([has(StaffRole.SuperAdmin, 'surveillance', 'Customer History'), has(StaffRole.CitizenFeedback, 'surveillance', 'Customer History'), has(StaffRole.QC, 'surveillance', 'Customer History')])
      .toEqual([false, false, true]);
    expect(has(StaffRole.Ministry, 'main', 'Customer History')).toBe(false);
  });

  describe('questionnaire menu (2026-11-08: one entry per level of Administration → Certification Levels)', () => {
    afterEach(() => setAllLevels(null));
    const questionnaire = (system: 'main' | 'surveillance') =>
      menuFor(StaffRole.Admin, [], system).filter((i) => i.menu === 'Questionnaire').map((i) => `${i.label} ${i.route}${i.legacyPath ? ' ' + i.legacyPath : ''}`);

    it('lists the built-in levels until the levels arrive', () => {
      expect(questionnaire('main')).toEqual([
        'Bronze /staff/masters/parameters/Bronze /Questionaire/Index?SectionType=Bronze',
        'Silver /staff/masters/parameters/Silver /Questionaire/Index?SectionType=Silver',
        'Gold /staff/masters/parameters/Gold /Questionaire/Index?SectionType=Gold',
        'ZED-X /staff/masters/parameters/ZEDX',
        'ESG Checklist /staff/settings/esg-checklist',
      ]);
    });

    it('adds a level the Admin added (PLATINUM), disabled ones too, in the Admin\'s order, on main and surveillance', () => {
      setAllLevels([
        { code: 'Bronze', name: 'Bronze', isEnabled: true, assessmentMode: 'Desktop', logoUrl: null, orderNo: 10 },
        { code: 'Silver', name: 'Silver', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 20 },
        { code: 'Gold', name: 'Gold', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 30 },
        { code: 'PLATINUM', name: 'Platinum', isEnabled: false, assessmentMode: 'Site', logoUrl: null, orderNo: 35 },
        { code: 'ZEDX', name: 'ZED-X (Export)', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 40 },
      ]);
      expect(questionnaire('main').map((l) => l.split(' /')[0])).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'ZED-X (Export)', 'ESG Checklist']);
      expect(questionnaire('main')[3]).toBe('Platinum /staff/masters/parameters/PLATINUM');
      expect(questionnaire('surveillance')).toContain('Platinum /staff/masters/parameters/PLATINUM');
      // A sub-user given the level's questionnaire sees it.
      expect(menuFor(StaffRole.Admin, [], 'main', ['/staff/masters/parameters/PLATINUM']).map((i) => i.label)).toEqual(['Platinum']);
    });
  });

  // 2026-11-21 (Assessor UI audit): the route guards check a menu screen as the menu does.
  describe('menuScreenAllows', () => {
    it('needs the sub-roles of the entry', () => {
      expect(menuScreenAllows('/staff/financial-assistance', StaffRole.DesktopAssessor, ['DesktopVerification'], 'main')).toBe(false);
      expect(menuScreenAllows('/staff/financial-assistance', StaffRole.DesktopAssessor, ['FinancialVerification'], 'main')).toBe(true);
      // The Master Admin's own entry has no sub-role.
      expect(menuScreenAllows('/staff/financial-assistance', StaffRole.MasterAdmin, [], 'main')).toBe(true);
    });

    it('needs the kind of agency of the entry', () => {
      expect(menuScreenAllows('/staff/schemes-verify/verification', StaffRole.DesktopAssessor, [], 'main')).toBe(false);
      expect(menuScreenAllows('/staff/schemes-verify/verification', StaffRole.DesktopAssessor, [DESKTOP_SCHEME_SUB_ROLE], 'main')).toBe(true);
      expect(menuScreenAllows('/staff/scheme-onsite/qc', StaffRole.Agency, [DESKTOP_SCHEME_SUB_ROLE], 'main')).toBe(false);
      expect(menuScreenAllows('/staff/scheme-onsite/qc', StaffRole.Agency, [ONSITE_SUB_ROLE], 'main')).toBe(true);
    });

    it('is null for a screen this portal has no menu entry for', () => {
      expect(menuScreenAllows('/staff/assessment/site-verification', StaffRole.DesktopAssessor, [], 'main')).toBeNull();
      expect(menuScreenAllows('/staff/financial-assistance', StaffRole.DesktopAssessor, ['FinancialVerification'], 'surveillance')).toBeNull();
    });
  });
});
