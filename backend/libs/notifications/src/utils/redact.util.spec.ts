import { maskEmail, maskPhone, maskRecipient, summariseProviderMessage } from './redact.util';

describe('maskEmail', () => {
  it('keeps the first and last character of each label and the TLD', () => {
    expect(maskEmail('alice@example.com')).toBe('a***e@e***e.com');
    expect(maskEmail('hira.malik@studio.co.uk')).toBe('h***k@s***o.c***o.uk');
  });

  it('never leaks the length of what it hides', () => {
    expect(maskEmail('a@example.com')).toBe('***@e***e.com');
    expect(maskEmail('averyverylongaddress@example.com')).toBe('a***s@e***e.com');
  });

  it('collapses an unparseable value rather than passing it through', () => {
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('alice@')).toBe('***');
  });

  it('trims before masking', () => {
    expect(maskEmail('  alice@example.com  ')).toBe('a***e@e***e.com');
  });
});

describe('maskPhone', () => {
  it('keeps the country prefix and the last three digits', () => {
    expect(maskPhone('+923001234567')).toBe('+92***567');
    expect(maskPhone('+92 300 123 4567')).toBe('+92***567');
    expect(maskPhone('03001234567')).toBe('03***567');
  });

  it('collapses a value with too few digits', () => {
    expect(maskPhone('+9230')).toBe('***');
    expect(maskPhone('')).toBe('***');
  });
});

describe('maskRecipient', () => {
  it('picks the mask for the channel', () => {
    expect(maskRecipient('EMAIL', 'alice@example.com')).toBe('a***e@e***e.com');
    expect(maskRecipient('SMS', '+923001234567')).toBe('+92***567');
  });
});

describe('summariseProviderMessage', () => {
  it('masks any address a provider echoed back at us', () => {
    const summary = summariseProviderMessage('550 mailbox alice@example.com unavailable');
    expect(summary).toContain('a***e@e***e.com');
    expect(summary).not.toContain('alice@example.com');
  });

  it('masks a phone number a gateway echoed back', () => {
    const summary = summariseProviderMessage('rejected destination +923001234567');
    expect(summary).toContain('+92***567');
    expect(summary).not.toContain('+923001234567');
  });

  it('fits inside the outbox lastError column', () => {
    expect(summariseProviderMessage('x'.repeat(1000)).length).toBeLessThanOrEqual(480);
  });

  it('collapses whitespace', () => {
    expect(summariseProviderMessage('  too   many\n\nspaces ')).toBe('too many spaces');
  });
});
