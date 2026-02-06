import { describe, it, expect } from 'vitest';
import { parseArgs, generateSampleData } from '../../scripts/run-evaluation.ts';

describe('run-evaluation CLI helpers', () => {
  it('parses CLI args', () => {
    const args = parseArgs(['--ab', '--stress', '--data=foo.json']);
    expect(args.runAb).toBe(true);
    expect(args.runStress).toBe(true);
    expect(args.dataPath).toBe('foo.json');
  });

  it('generates sample data', () => {
    const data = generateSampleData();
    expect(data.length).toBeGreaterThan(0);
  });
});
