import { StaffRole, menuFor } from './staff-menu';

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
    ]);
  });

  it('gives an unknown role nothing', () => {
    expect(menuFor(12, [])).toEqual([]);
  });
});
