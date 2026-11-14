import { StaffMenuEntry, StaffMenuItem, StaffRole, homeFor, menuEntries, menuFor } from './staff-menu';
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
      expect(c(StaffRole.Agency, ['FinancialVerification'])).toEqual(['Consultants/Experts', 'Reports', 'Technology Upgradation', 'Documents', 'Sub-Users']);
    });

    it('gives consultants the milestone lists, pointing at the site-assessment routes', () => {
      const items = menuFor(StaffRole.DesktopAssessor, ['SiteVerification'], 'consultancy');
      expect(items.filter((i) => i.label.startsWith('Milestone')).map((i) => i.route)).toEqual([
        '/staff/site-assessment/milestones/1', '/staff/site-assessment/milestones/2', '/staff/site-assessment/milestones/3',
      ]);
    });

    it('has no categories, technologies masters or legacy links', () => {
      const admin = c(StaffRole.Admin, []);
      expect(admin).toEqual(['All settings', 'Upload Image', 'Documents/Videos', 'Sectors', 'Payments', 'User Management', 'Captcha Settings', 'Email Settings', 'Professional Verification', 'Email Templates', 'Texts', 'App Forms']);
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
        'Allot Surveillance', 'Bronze Surveillance Agencies', 'Surveillance Payment Received', 'Surveillance Monitoring',
        'Surveillance Completed', 'Surveillance Rejected',
      ]));
    });

    it('shows every assessor Completed and Non-Conformances, whatever the sub-role', () => {
      expect(s(StaffRole.DesktopAssessor, ['SiteVerification'])).toEqual(expect.arrayContaining(['Completed', 'Non-Conformances']));
      expect(s(StaffRole.DesktopAssessor, ['SiteVerification'])).not.toContain('Surveillance Assessments');
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
      expect(bar(StaffRole.MasterAdmin, 'main')).toEqual(['Agencies (5)', 'Assessment (6)', 'Schemes (2)', 'Documents', 'Operation Admins']);
      expect(bar(StaffRole.Admin, 'main')).toEqual([
        'All settings', 'Masters (6)', 'Questionnaire (5)', 'Technology Upgradation (2)', 'Incentives (5)', 'User Management', 'Administration (11)',
      ]);
      expect(bar(StaffRole.Admin, 'consultancy')).toEqual(['All settings', 'Masters (4)', 'User Management', 'Administration (6)']);
      expect(bar(StaffRole.Admin, 'surveillance')).toEqual(['All settings', 'Masters (2)', 'Questionnaire (5)', 'User Management', 'Administration (8)']);
      // The incentives in four groups, a page each (the state is chosen on the State Government page), and the MSME dashboard's cards.
      expect(menuFor(StaffRole.Admin, [], 'main').filter((i) => i.group === 'Incentives').map((i) => `${i.label} ${i.route}`)).toEqual([
        'Ministry of MSME /staff/incentives/ministry', 'State Government /staff/incentives/state',
        'Financial Institution /staff/incentives/financial', 'Others /staff/incentives/others',
        'Main Dashboard Cards /staff/incentives/dashboard-cards',
      ]);
      expect(bar(StaffRole.MasterAdmin, 'consultancy')).toEqual(['Allot Consultancy', 'Consultancy Monitoring (6)', 'Technology Upgradation', 'Documents', 'Operation Admins']);
      expect(bar(StaffRole.MasterAdmin, 'surveillance')).toEqual(['Allot Surveillance', 'Surveillance Monitoring (7)', 'Operation Admins', 'Documents']);
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
      expect(agency('main')).toEqual(['Reports', 'Assessment (3)', 'Assessors', 'Allotment (2)', 'Financial Assistance', 'Documents', 'Sub-Users']);
      expect(agency('surveillance')).toEqual(['Surveillance (3)', 'Assessors', 'Allotment (2)', 'Reports', 'Sub-Users', 'Documents']);
      expect(agency('consultancy')).toEqual(['Consultancy (3)', 'Consultants/Experts', 'Reports', 'Technology Upgradation', 'Documents', 'Sub-Users']);
      // An agency with only desktop verification has one allotment screen: a link, not a drop-down.
      expect(menuEntries(menuFor(StaffRole.Agency, ['DesktopVerification'], 'main')).some((e) => 'item' in e && e.item.label === 'DA Allotment')).toBe(true);
      expect(menuEntries(menuFor(StaffRole.DesktopAssessor, ['DesktopVerification', 'SiteVerification'], 'main')).every((e) => 'item' in e)).toBe(true);
    });
  });
  describe('sub-users', () => {
    it('get only the screens their owner gave them, without user management', () => {
      const labels = (role: number, subs: string[], routes: string[], system: 'main' | 'consultancy' | 'surveillance' = 'main') =>
        menuFor(role, subs, system, routes).map((i) => i.label);
      expect(labels(StaffRole.MasterAdmin, [], ['/staff/assessment/allot', '/staff/assessment/completed', '/staff/assessment/rejected'])).toEqual([
        'Allot Assessment', 'Assessment Completed', 'Rejected Certification',
      ]);
      expect(labels(StaffRole.Agency, ['DesktopVerification'], ['/staff/users/my-assessors', '/staff/users/assessors'])).toEqual(['Assessors']);
      expect(labels(StaffRole.Agency, ['DesktopVerification'], [])).toEqual([]);
      // Owners keep the whole menu.
      expect(menuFor(StaffRole.Agency, ['DesktopVerification'], 'main', null).map((i) => i.label)).toContain('Sub-Users');
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
});
