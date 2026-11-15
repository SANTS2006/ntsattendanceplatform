import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSender, renderHtml, sendMail, sendViaBrevo, testOutbox } from '../../src/infra/mailer.js';

afterEach(() => vi.unstubAllGlobals());

describe('mailer', () => {
  it('parses the sender and renders a branded HTML body with the code box', () => {
    expect(parseSender('NTSAttend <no-reply@uni.edu>')).toEqual({ name: 'NTSAttend', email: 'no-reply@uni.edu' });
    expect(parseSender('ops@uni.edu')).toEqual({ name: 'NTSAttend', email: 'ops@uni.edu' });
    const html = renderHtml('K7QM2X is your code', 'Hello <b>Ada</b>,\n\nUse this code:\n\n    K7QM2X\n\nThanks');
    expect(html).toContain('letter-spacing:10px');
    expect(html).toContain('>K7QM2X<');
    expect(html).toContain('&lt;b&gt;Ada&lt;/b&gt;'); // user-supplied text is escaped
  });

  it('captures mail in tests instead of sending it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendMail({ to: 'captured@uni.edu', subject: 'Hi', text: 'Body' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testOutbox().at(-1)).toMatchObject({ to: 'captured@uni.edu', subject: 'Hi' });
  });

  it('sends through the Brevo transactional API and reports Brevo errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"messageId":"x"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendViaBrevo({ to: 'student@uni.edu', subject: 'Hi', text: 'Body', html: '<p>Body</p>' }, 'test-key', 'NTSAttend <no-reply@uni.edu>');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('test-key');
    expect(JSON.parse(init.body)).toMatchObject({ sender: { name: 'NTSAttend', email: 'no-reply@uni.edu' }, to: [{ email: 'student@uni.edu' }], subject: 'Hi', textContent: 'Body', htmlContent: '<p>Body</p>' });
    fetchMock.mockResolvedValueOnce(new Response('{"message":"sender not verified"}', { status: 400 }));
    await expect(sendViaBrevo({ to: 'a@b.c', subject: 's', text: 't', html: 'h' }, 'k', 'x@y.z')).rejects.toThrow(/Brevo send failed \(400\)/);
  });
});
