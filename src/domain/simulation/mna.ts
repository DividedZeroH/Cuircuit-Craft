/** Dense linear solver for the modified nodal analysis system (Gaussian elimination with partial pivoting). */
export function solveLinear(A: number[][], b: number[], N: number): number[] {
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-18) continue;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < N; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < N; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array<number>(N).fill(0);
  for (let r = N - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < N; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) < 1e-18 ? 0 : s / A[r][r];
  }
  return x;
}

/** Builds A·x = b row by row. Node −1 is ground; −2 means "not connected" and is ignored. */
export class MnaSystem {
  readonly A: number[][];
  readonly b: number[];
  constructor(readonly N: number) {
    this.A = Array.from({ length: N }, () => new Array<number>(N).fill(0));
    this.b = new Array<number>(N).fill(0);
  }
  conductance(a: number, c: number, g: number): void {
    if (a < -1 || c < -1) return;
    if (a >= 0) this.A[a][a] += g;
    if (c >= 0) this.A[c][c] += g;
    if (a >= 0 && c >= 0) { this.A[a][c] -= g; this.A[c][a] -= g; }
  }
  /** Current injected into node a. */
  current(a: number, i: number): void { if (a >= 0) this.b[a] += i; }
  voltageSource(row: number, a: number, c: number, v: number): void {
    if (a >= 0) { this.A[a][row] += 1; this.A[row][a] += 1; }
    if (c >= 0) { this.A[c][row] -= 1; this.A[row][c] -= 1; }
    this.b[row] = v;
  }
  solve(): number[] { return solveLinear(this.A, this.b, this.N); }
}
