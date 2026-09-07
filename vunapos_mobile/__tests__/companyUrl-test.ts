import { normalizeCompanyUrl } from '@/config/companyUrl';

describe('normalizeCompanyUrl', () => {
  it.each([
    ['https://vuna.example.com', 'https://vuna.example.com'],
    ['  vuna.example.com  ', 'https://vuna.example.com'],
    ['https://vuna.example.com:8443', 'https://vuna.example.com:8443'],
    ['http://10.0.2.2:8000', 'http://10.0.2.2:8000'],
    ['http://localhost:8000', 'http://localhost:8000'],
  ])('normalizes a permitted company origin: %s', (input, url) => {
    expect(normalizeCompanyUrl(input)).toEqual({ ok: true, url });
  });

  it.each([
    ['', 'Enter your company URL.'],
    ['not a url', 'Enter a valid http:// or https:// address.'],
    ['ftp://vuna.example.com', 'Enter a valid http:// or https:// address.'],
    ['https://vuna.example.com/vunapos', 'Enter the site address only, without a path or sign-in details.'],
    ['https://user:password@vuna.example.com', 'Enter the site address only, without a path or sign-in details.'],
    ['https://vuna.example.com?site=vunapos', 'Enter the site address only, without a path or sign-in details.'],
    ['https://vuna.example.com#sign-in', 'Enter the site address only, without a path or sign-in details.'],
    ['http://vuna.example.com', 'Use https:// to keep your sign-in details secure.'],
  ])('rejects an invalid company URL: %s', (input, message) => {
    expect(normalizeCompanyUrl(input)).toEqual({ ok: false, message });
  });
});
