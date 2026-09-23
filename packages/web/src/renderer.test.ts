import { describe, it, expect, vi } from 'vitest';
import { Text } from '@earendil-works/pi-tui';
import { reuseText, sanitizeStatus, renderWebSearchCall } from './renderer';

describe('renderer', () => {
  it('reuseText recycles existing Text component', () => {
    const existing = new Text('existing', 0, 0);
    const context = { lastComponent: existing };
    expect(reuseText(context)).toBe(existing);
  });

  it('reuseText creates new Text if not exists', () => {
    const result = reuseText({});
    expect(result).toBeInstanceOf(Text);
    expect(result.render(100)).toEqual([]);
  });

  it('sanitizeStatus strips control characters', () => {
    expect(sanitizeStatus('hello\nworld')).toBe('hello world');
    expect(sanitizeStatus('tab\tspace')).toBe('tab space');
    expect(sanitizeStatus('control\x00char')).toBe('control char');
  });

  it('exception resilience: renderer does not throw on malformed input', () => {
    const mockTheme = {} as any;
    expect(() => {
        renderWebSearchCall(null, mockTheme);
    }).not.toThrow();
  });
});
