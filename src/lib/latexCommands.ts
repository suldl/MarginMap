/**
 * LaTeX commands offered by the formula autocomplete. `insert` may contain `$1`, `$2`…
 * tab stops (the caret lands on `$1`; Tab jumps to the next empty `{}`).
 * Every entry's `preview` is checked against KaTeX by `scripts/check-latex.mjs`.
 */
export interface TexCommand {
  /** Command name without the backslash, used for matching. */
  name: string;
  insert: string;
  preview: string;
  hint?: string;
}

const sym = (hint: string, names: string) =>
  names.split(/\s+/).filter(Boolean).map((name): TexCommand => ({ name, insert: `\\${name}`, preview: `\\${name}`, hint }));

const tpl = (hint: string, entries: [name: string, insert: string, preview: string][]) =>
  entries.map(([name, insert, preview]): TexCommand => ({ name, insert, preview, hint }));

export const TEX_COMMANDS: TexCommand[] = [
  ...tpl('structure', [
    ['frac', '\\frac{$1}{$2}', '\\frac{a}{b}'],
    ['dfrac', '\\dfrac{$1}{$2}', '\\dfrac{a}{b}'],
    ['tfrac', '\\tfrac{$1}{$2}', '\\tfrac{a}{b}'],
    ['sqrt', '\\sqrt{$1}', '\\sqrt{x}'],
    ['sqrt[n]', '\\sqrt[$1]{$2}', '\\sqrt[n]{x}'],
    ['binom', '\\binom{$1}{$2}', '\\binom{n}{k}'],
    ['sum', '\\sum_{$1}^{$2}', '\\sum_{i=1}^{n}'],
    ['prod', '\\prod_{$1}^{$2}', '\\prod_{i=1}^{n}'],
    ['int', '\\int_{$1}^{$2}', '\\int_{a}^{b}'],
    ['iint', '\\iint', '\\iint'],
    ['iiint', '\\iiint', '\\iiint'],
    ['oint', '\\oint', '\\oint'],
    ['lim', '\\lim_{$1 \\to $2}', '\\lim_{x \\to 0}'],
    ['limsup', '\\limsup_{$1}', '\\limsup_{n}'],
    ['liminf', '\\liminf_{$1}', '\\liminf_{n}'],
    ['bigcup', '\\bigcup_{$1}', '\\bigcup_{i}'],
    ['bigcap', '\\bigcap_{$1}', '\\bigcap_{i}'],
    ['bigoplus', '\\bigoplus_{$1}', '\\bigoplus_{i}'],
    ['bigotimes', '\\bigotimes_{$1}', '\\bigotimes_{i}'],
    ['coprod', '\\coprod', '\\coprod'],
  ]),
  ...tpl('accent', [
    ['hat', '\\hat{$1}', '\\hat{x}'],
    ['widehat', '\\widehat{$1}', '\\widehat{xy}'],
    ['bar', '\\bar{$1}', '\\bar{x}'],
    ['overline', '\\overline{$1}', '\\overline{AB}'],
    ['underline', '\\underline{$1}', '\\underline{x}'],
    ['vec', '\\vec{$1}', '\\vec{v}'],
    ['overrightarrow', '\\overrightarrow{$1}', '\\overrightarrow{AB}'],
    ['dot', '\\dot{$1}', '\\dot{x}'],
    ['ddot', '\\ddot{$1}', '\\ddot{x}'],
    ['tilde', '\\tilde{$1}', '\\tilde{x}'],
    ['widetilde', '\\widetilde{$1}', '\\widetilde{xy}'],
    ['overbrace', '\\overbrace{$1}^{$2}', '\\overbrace{a+b}^{n}'],
    ['underbrace', '\\underbrace{$1}_{$2}', '\\underbrace{a+b}_{n}'],
    ['overset', '\\overset{$1}{$2}', '\\overset{!}{=}'],
    ['underset', '\\underset{$1}{$2}', '\\underset{x}{\\max}'],
    ['stackrel', '\\stackrel{$1}{$2}', '\\stackrel{def}{=}'],
    ['cancel', '\\cancel{$1}', '\\cancel{x}'],
    ['boxed', '\\boxed{$1}', '\\boxed{x=1}'],
  ]),
  ...tpl('font', [
    ['mathbb', '\\mathbb{$1}', '\\mathbb{R}'],
    ['mathcal', '\\mathcal{$1}', '\\mathcal{L}'],
    ['mathbf', '\\mathbf{$1}', '\\mathbf{x}'],
    ['boldsymbol', '\\boldsymbol{$1}', '\\boldsymbol{\\alpha}'],
    ['mathrm', '\\mathrm{$1}', '\\mathrm{d}x'],
    ['mathit', '\\mathit{$1}', '\\mathit{abc}'],
    ['mathsf', '\\mathsf{$1}', '\\mathsf{A}'],
    ['mathtt', '\\mathtt{$1}', '\\mathtt{x}'],
    ['mathfrak', '\\mathfrak{$1}', '\\mathfrak{g}'],
    ['mathscr', '\\mathscr{$1}', '\\mathscr{F}'],
    ['text', '\\text{$1}', '\\text{if }x'],
    ['operatorname', '\\operatorname{$1}', '\\operatorname{rank}'],
    ['textcolor', '\\textcolor{$1}{$2}', '\\textcolor{red}{x}'],
  ]),
  ...tpl('environment', [
    ['begin{matrix}', '\\begin{matrix}\n$1\n\\end{matrix}', '\\begin{matrix}a&b\\\\c&d\\end{matrix}'],
    ['begin{pmatrix}', '\\begin{pmatrix}\n$1\n\\end{pmatrix}', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'],
    ['begin{bmatrix}', '\\begin{bmatrix}\n$1\n\\end{bmatrix}', '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}'],
    ['begin{vmatrix}', '\\begin{vmatrix}\n$1\n\\end{vmatrix}', '\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}'],
    ['begin{cases}', '\\begin{cases}\n$1 & \\text{if } $2 \\\\\n & \\text{otherwise}\n\\end{cases}', '\\begin{cases}1&x>0\\\\0&\\text{else}\\end{cases}'],
    ['begin{aligned}', '\\begin{aligned}\n$1 &= $2 \\\\\n\\end{aligned}', '\\begin{aligned}a&=b\\\\&=c\\end{aligned}'],
    ['begin{gathered}', '\\begin{gathered}\n$1\n\\end{gathered}', '\\begin{gathered}a=b\\\\c=d\\end{gathered}'],
  ]),
  ...tpl('delimiter', [
    ['left(', '\\left( $1 \\right)', '\\left(\\frac{a}{b}\\right)'],
    ['left[', '\\left[ $1 \\right]', '\\left[\\frac{a}{b}\\right]'],
    ['left\\{', '\\left\\{ $1 \\right\\}', '\\left\\{\\frac{a}{b}\\right\\}'],
    ['left|', '\\left| $1 \\right|', '\\left|\\frac{a}{b}\\right|'],
    ['langle', '\\langle $1 \\rangle', '\\langle x, y \\rangle'],
    ['lfloor', '\\lfloor $1 \\rfloor', '\\lfloor x \\rfloor'],
    ['lceil', '\\lceil $1 \\rceil', '\\lceil x \\rceil'],
    ['norm', '\\lVert $1 \\rVert', '\\lVert x \\rVert'],
  ]),
  ...sym('delimiter', 'rangle rfloor rceil vert Vert lvert rvert lVert rVert'),
  ...tpl('delimiter', [
    ['big', '\\big( $1 \\big)', '\\big( x \\big)'],
    ['Big', '\\Big( $1 \\Big)', '\\Big( x \\Big)'],
    ['bigg', '\\bigg( $1 \\bigg)', '\\bigg( x \\bigg)'],
    ['Bigg', '\\Bigg( $1 \\Bigg)', '\\Bigg( x \\Bigg)'],
  ]),
  ...sym('greek', 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega'),
  ...sym('greek', 'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'),
  ...sym('function', 'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp max min sup inf arg det dim ker deg gcd hom Pr'),
  ...tpl('function', [
    ['bmod', '\\bmod', 'a \\bmod b'],
    ['pmod', '\\pmod{$1}', 'a \\equiv b \\pmod{n}'],
  ]),
  ...sym('relation', 'leq geq neq approx equiv sim simeq cong propto ll gg le ge ne doteq models vdash prec succ preceq succeq asymp'),
  ...sym('set', 'in notin ni subset supset subseteq supseteq subsetneq supsetneq cup cap setminus emptyset varnothing complement'),
  ...sym('operator', 'times div pm mp cdot ast star circ bullet oplus otimes ominus odot wedge vee land lor lnot neg dagger'),
  ...sym('arrow', 'to gets rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow implies impliedby iff mapsto longrightarrow longleftarrow longmapsto uparrow downarrow updownarrow nearrow searrow swarrow nwarrow hookrightarrow hookleftarrow rightleftharpoons leftrightarrows'),
  ...tpl('arrow', [
    ['xrightarrow', '\\xrightarrow{$1}', '\\xrightarrow{f}'],
    ['xleftarrow', '\\xleftarrow{$1}', '\\xleftarrow{f}'],
  ]),
  ...sym('logic', 'forall exists nexists therefore because top bot'),
  ...sym('symbol', 'infty partial nabla hbar ell Re Im aleph prime angle triangle square degree checkmark perp parallel mid nmid sharp flat natural clubsuit diamondsuit heartsuit spadesuit'),
  ...sym('dots', 'ldots cdots vdots ddots dots'),
  ...tpl('spacing', [
    ['quad', '\\quad', 'a\\quad b'],
    ['qquad', '\\qquad', 'a\\qquad b'],
  ]),
  ...tpl('style', [
    ['displaystyle', '\\displaystyle ', '\\displaystyle\\sum_{i}'],
    ['textstyle', '\\textstyle ', '\\textstyle\\sum_{i}'],
    ['not', '\\not', '\\not\\in'],
  ]),
];

/** Best matches for a typed command prefix: exact/prefix matches first, then substrings. */
export function suggestCommands(query: string, limit = 40): TexCommand[] {
  if (!query) return TEX_COMMANDS.slice(0, limit);
  const q = query.toLowerCase();
  const scored: { c: TexCommand; score: number; idx: number }[] = [];
  TEX_COMMANDS.forEach((c, idx) => {
    const n = c.name.toLowerCase();
    let score = -1;
    if (c.name === query) score = 0;
    else if (c.name.startsWith(query)) score = 1;
    else if (n.startsWith(q)) score = 2;
    else if (n.includes(q)) score = 3;
    if (score >= 0) scored.push({ c, score, idx });
  });
  scored.sort((a, b) => a.score - b.score || a.c.name.length - b.c.name.length || a.idx - b.idx);
  return scored.slice(0, limit).map((s) => s.c);
}
