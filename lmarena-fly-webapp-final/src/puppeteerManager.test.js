const { fetchAvailableModels } = require('./puppeteerManager');

describe('fetchAvailableModels', () => {
  let mockPage;
  let sseSendMock;

  beforeEach(() => {
    sseSendMock = jest.fn();
    mockPage = {
      url: jest.fn().mockReturnValue('https://beta.lmarena.ai/'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      $: jest.fn(),
      $: jest.fn(),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      evaluate: jest.fn(),
      screenshot: jest.fn().mockResolvedValue(undefined)
    };
  });

  it('returns models from UI if found', async () => {
    // Mock selectors and model elements
    mockPage.$.mockImplementation((selector) => {
      if (selector.includes('button[aria-haspopup="listbox"]')) return { click: jest.fn().mockResolvedValue(undefined) };
      return null;
    });
    mockPage.$.mockImplementation((selector) => {
      if (selector.includes('div[data-radix-collection-item]')) {
        return [
          {
            evaluate: jest.fn().mockImplementation((fn) => fn({ textContent: 'gpt4' })),
          },
          {
            evaluate: jest.fn().mockImplementation((fn) => fn({ textContent: 'claude3' })),
          }
        ];
      }
      return [];
    });

    const result = await fetchAvailableModels(mockPage, sseSendMock);
    expect(result).toEqual([
      { id: 'gpt4', name: 'gpt4' },
      { id: 'claude3', name: 'claude3' }
    ]);
    expect(sseSendMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'STATUS' }));
  });

  it('returns default models if nothing found', async () => {
    mockPage.$.mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) });
    mockPage.$.mockResolvedValue([]);
    // API fallback fails
    mockPage.evaluate.mockResolvedValue(null);

    const result = await fetchAvailableModels(mockPage, sseSendMock);
    expect(result.some((m) => m.id === 'claude-3-opus-20240229')).toBe(true);
    expect(result.some((m) => m.id === 'gpt-4o-latest-20250326')).toBe(true);
    expect(result.some((m) => m.id === 'gemini-2.0-flash-001')).toBe(true);
    expect(sseSendMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'STATUS' }));
  });

  it('returns empty array and error if navigation fails', async () => {
    mockPage.url.mockReturnValue('badurl');
    mockPage.goto.mockRejectedValue(new Error('fail nav'));

    const result = await fetchAvailableModels(mockPage, sseSendMock);
    expect(result).toEqual([]);
    expect(sseSendMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ERROR' }));
  });
});