import { ElapsedTimePipe } from './elapsed-time.pipe';

describe('ElapsedTimePipe', () => {
  const pipe = new ElapsedTimePipe();
  const nowMs = 1_000_000;

  it('formats sub-second elapsed time in milliseconds', () => {
    expect(pipe.transform(nowMs - 450, nowMs)).toBe('450 ms');
  });

  it('formats seconds', () => {
    expect(pipe.transform(nowMs - 5_000, nowMs)).toBe('5 s ago');
  });

  it('formats minutes', () => {
    expect(pipe.transform(nowMs - 5 * 60_000, nowMs)).toBe('5 m ago');
  });

  it('formats hours', () => {
    expect(pipe.transform(nowMs - 3 * 60 * 60_000, nowMs)).toBe('3 h ago');
  });

  it('defaults to the current time and never goes negative', () => {
    expect(pipe.transform(Date.now() + 5_000)).toMatch(/0 ms/);
  });
});
