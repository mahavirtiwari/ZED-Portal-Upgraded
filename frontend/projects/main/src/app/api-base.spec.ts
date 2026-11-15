import { apiBasePath, rebaseApiUrls, withApiBase } from './api-base';

describe('api-base', () => {
  it('prefixes /api paths with the build base', () => {
    expect(apiBasePath('/Consultancy/')).toBe('/Consultancy');
    expect(apiBasePath('/')).toBe('');
    expect(withApiBase('/api/x', '/Consultancy')).toBe('/Consultancy/api/x');
    expect(withApiBase('Images/a.svg', '/Consultancy')).toBe('Images/a.svg');
  });

  it('rebases the file addresses in a response (2026-11-15: milestone photos asked main /api on the Consultancy build)', () => {
    const d = {
      siteTour: [{ id: 1, name: '/api/not-a-url-key', url: '/api/consultancy/milestones/Z/Silver/files/a.jpg' }],
      attendance: [{ LoginPhotoUrl: '/api/consultancy/milestones/Z/Silver/files/s.jpg', LogoutPhotoUrl: null, Name: 'A' }],
      openMeetings: [{ photos: [{ url: '/api/f.jpg' }] }],
      videoUrl: 'https://example.org/v.mp4',
    };
    const r = rebaseApiUrls(d, '/Consultancy');
    expect(r.siteTour[0].url).toBe('/Consultancy/api/consultancy/milestones/Z/Silver/files/a.jpg');
    expect(r.siteTour[0].name).toBe('/api/not-a-url-key');
    expect(r.attendance[0].LoginPhotoUrl).toBe('/Consultancy/api/consultancy/milestones/Z/Silver/files/s.jpg');
    expect(r.attendance[0].LogoutPhotoUrl).toBeNull();
    expect(r.openMeetings[0].photos[0].url).toBe('/Consultancy/api/f.jpg');
    expect(r.videoUrl).toBe('https://example.org/v.mp4');
    // Main (base "/") is unchanged.
    expect(rebaseApiUrls(d, '')).toBe(d);
  });
});
