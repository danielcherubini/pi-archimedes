import { describe, it, expect, vi } from 'vitest';
import { registerCommand } from './command';

describe('slash command registration', () => {
  it('should register /web command', () => {
    const mockPi = {
      registerCommand: vi.fn(),
    };
    registerCommand(mockPi as any);
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      'web',
      expect.objectContaining({ description: "Web search tools" })
    );
  });
});
