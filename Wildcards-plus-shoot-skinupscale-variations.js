// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
// @api-1.0
// Name: Wildcards Plus (Photoshoot + Skin Refine)
// Description: Wildcard generator that runs a skin refinement/upscale pass after every generation.
// Author: ariane-emory (Modified for Refine Pass & Variations)

// =====================================================================================
// PART 1: GRAMMAR ENGINE (Full Feature Set)
// =====================================================================================
{
  inspect_fun = JSON.stringify;
  dt_hosted = true;
}

let string_input_mode_enabled = true;
let log_enabled = true;
let log_config = true;
let log_finalize_enabled = false;
let log_match_enabled = false;
let disable_prelude = false;

const DISCARD = Symbol('DISCARD');
const trailing_separator_modes = Object.freeze({
  allowed: 'allowed',
  required: 'required',
  forbidden: 'forbidden'
});

class Rule {
  match(input, index = 0, indent = 0) {
    const ret = this.__match(indent, input, index);
    if (ret && ret?.value === undefined) {
      // Silently fail rather than throw on some undefineds to be more robust
      return null; 
    }
    return ret;
  }
  __match(indent, input, index) { throw new Error(`__match is not implemented`); }
  finalize(indent = 0) { this.__finalize(indent, new Set()); }
  __finalize(indent, visited) {
    if (visited.has(this)) return;
    visited.add(this);
    this.__impl_finalize(indent, visited);
  }
  __impl_finalize(indent, visited) { throw new Error(`__impl_finalize is not implemented`); }
  toString() { return this.__toString(new Map(), { value: 0 }).replace('() => ', ''); }
  __toString(visited, next_id) {
    if (visited.has(this)) return `#${visited.get(this)}`;
    next_id.value += 1;
    visited.set(this, next_id.value);
    return this.__impl_toString(visited, next_id).replace('() => ', '');
  }
  __impl_toString(visited, next_id) { throw new Error(`__impl_toString is not implemented`); }
  __vivify(thing) {
    if (thing instanceof ForwardReference) thing = thing.func;
    if (typeof thing === 'function') thing = thing();
    return thing;
  }
}

class Quantified extends Rule {
  constructor(rule, separator_rule = null, trailing_separator_mode = trailing_separator_modes.forbidden) {
    super();
    this.rule = make_rule_func(rule);
    this.separator_rule = make_rule_func(separator_rule);
    this.trailing_separator_mode = trailing_separator_mode;
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.separator_rule = this.__vivify(this.separator_rule);
    this.rule.__finalize(indent + 1, visited);
    this.separator_rule?.__finalize(indent + 1, visited);
  }
  __quantified_match(indent, input, index) {
    const values = [];
    let prev_index = null;
    const rewind_index = () => index = prev_index;
    const update_index = (ix) => { prev_index = index; index = ix; };
    indent += 1;
    let match_result = this.rule.match(input, index, indent + 1);
    if (match_result === undefined) return null; 
    if (match_result === false) return null;
    if (match_result === null) return new MatchResult([], input, index);
    if (match_result.value !== DISCARD) values.push(match_result.value);
    update_index(match_result.index);
    while (true) {
      if (this.separator_rule) {
        const separator_match_result = this.separator_rule.match(input, index, indent + 1);
        if (!separator_match_result) {
          if (this.trailing_separator_mode == trailing_separator_modes.required) {
            rewind_index();
            values.pop();
          }
          break;
        }
        update_index(separator_match_result.index);
      }
      match_result = this.rule.match(input, index, indent + 1);
      if (!match_result) {
        if (this.separator_rule) {
          if (this.trailing_separator_mode == trailing_separator_modes.forbidden) {
            rewind_index();
          }
        }
        break;
      }
      if (match_result.value !== DISCARD) values.push(match_result.value);
      update_index(match_result.index);
    };
    return new MatchResult(values, input, index);
  }
}

class Plus extends Quantified {
  __match(indent, input, index) {
    const __quantified_match_result = this.__quantified_match(indent, input, index);
    return __quantified_match_result?.value.length == 0 ? null : __quantified_match_result;
  }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.rule).__toString(visited, next_id)}+`; }
}
function plus(rule, separator_value = null, trailing_separator_mode = trailing_separator_modes.forbidden) { return new Plus(rule, separator_value, trailing_separator_mode); }

class Star extends Quantified {
  __match(indent, input, index) { return this.__quantified_match(indent, input, index); }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.rule).__toString(visited, next_id)}*`; }
}
// CRITICAL FIX: Allow changing trailing mode via constructor
function star(value, separator_value = null, trailing_separator_mode = trailing_separator_modes.forbidden) { return new Star(value, separator_value, trailing_separator_mode); }

class Choice extends Rule {
  constructor(...options) {
    super();
    this.options = options.map(make_rule_func);
  }
  __impl_finalize(indent, visited) {
    for (let ix = 0; ix < this.options.length; ix++) {
      this.options[ix] = this.__vivify(this.options[ix]);
      this.options[ix].__finalize(indent + 1, visited);
    }
  }
  __match(indent, input, index) {
    for (const option of this.options) {
      const match_result = option.match(input, index, indent + 2);
      if (match_result) return match_result;
    }
    return null;
  }
  __impl_toString(visited, next_id) { return `{ ${this.options.map(x => this.__vivify(x).__toString(visited, next_id)).join(" | ")} }`; }
}
function choice(...options) { if (options.length == 1) return make_rule_func(options[0]); return new Choice(...options) }

class Discard extends Rule {
  constructor(rule) {
    super();
    this.rule = make_rule_func(rule);
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule?.__finalize(indent + 1, visited);
  }
  __match(indent, input, index) {
    if (!this.rule) return new MatchResult(null, input, index);
    const match_result = this.rule.match(input, index, indent + 1);
    if (!match_result) return null;
    return new MatchResult(DISCARD, input, match_result.index);
  }
  __impl_toString(visited, next_id) { return `-${this.__vivify(this.rule).__toString(visited, next_id)}`; }
}
function discard(rule) { return new Discard(rule) }

class Element extends Rule {
  constructor(index, rule) {
    super();
    this.index = index;
    this.rule = make_rule_func(rule);
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(input, index, indent + 1);
    if (!rule_match_result) return null;
    const ret = rule_match_result.value[this.index] === undefined ? DISCARD : rule_match_result.value[this.index];
    rule_match_result.value = ret;
    return rule_match_result
  }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.rule)?.__toString(visited, next_id)}[${this.index}]`; }
}
function elem(index, rule) { return new Element(index, rule) }
function first(rule) { return new Element(0, rule) }
function second(rule) { return new Element(1, rule) }
function third(rule) { return new Element(2, rule) }

class Enclosed extends Rule {
  constructor(start_rule, body_rule, end_rule) {
    super();
    if (!end_rule) { end_rule = body_rule; body_rule = start_rule; start_rule = end_rule; }
    this.start_rule = make_rule_func(start_rule);
    this.body_rule = make_rule_func(body_rule);
    this.end_rule = make_rule_func(end_rule);
    if (!this.end_rule) this.end_rule = this.start_rule;
  }
  __fail_or_throw_error(start_rule_result, failed_rule_result, input, index) { return null; }
  __impl_finalize(indent, visited) {
    this.start_rule = this.__vivify(this.start_rule);
    this.body_rule = this.__vivify(this.body_rule);
    this.end_rule = this.__vivify(this.end_rule);
    this.start_rule.__finalize(indent + 1, visited);
    this.body_rule.__finalize(indent + 1, visited);
    this.end_rule.__finalize(indent + 1, visited);
  }
  __match(indent, input, index) {
    const start_rule_match_result = this.start_rule.match(input, index, indent + 1);
    if (!start_rule_match_result) return null;
    const body_rule_match_result = this.body_rule.match(input, start_rule_match_result.index, indent + 1);
    if (!body_rule_match_result) return this.__fail_or_throw_error(start_rule_match_result, body_rule_match_result, input, start_rule_match_result.index);
    const end_rule_match_result = this.end_rule.match(input, body_rule_match_result.index, indent + 1);
    if (!end_rule_match_result) return this.__fail_or_throw_error(start_rule_match_result, body_rule_match_result, input, body_rule_match_result.index);
    return new MatchResult(body_rule_match_result.value, input, end_rule_match_result.index);
  }
  __impl_toString(visited, next_id) { return `[${this.__vivify(this.start_rule).__toString(visited, next_id)} ${this.__vivify(this.body_rule).__toString(visited, next_id)} ${this.__vivify(this.end_rule).__toString(visited, next_id)}]`; }
}
function enc(start_rule, body_rule, end_rule) { return new Enclosed(start_rule, body_rule, end_rule); }

class CuttingEnclosed extends Enclosed {
  constructor(start_rule, body_rule, end_rule) { super(start_rule, body_rule, end_rule); }
  __fail_or_throw_error(start_rule_result, failed_rule_result, input, index) {
    if (string_input_mode_enabled) { throw new Error(`expected (${this.body_rule} ${this.end_rule}) after ${this.start_rule} at char ${index}, found: "${input.substring(start_rule_result.index)}"`); }
    else { throw new Error(`expected (${this.body_rule} ${this.end_rule}) after ${this.start_rule} at char ${input[start_rule_result.index].start}, found: [ ${input.slice(start_rule_result.index).join(", ")} ]`); }
  }
  __impl_toString(visited, next_id) { return `[${this.__vivify(this.start_rule).__toString(visited, next_id)} ${this.__vivify(this.body_rule).__toString(visited, next_id)}! ${this.__vivify(this.end_rule).__toString(visited, next_id)}!]` }
}
function cutting_enc(start_rule, body_rule, end_rule) { return new CuttingEnclosed(start_rule, body_rule, end_rule); }

class Label extends Rule {
  constructor(label, rule) {
    super();
    this.label = label;
    this.rule = make_rule_func(rule);
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(input, index, indent);
    if (!rule_match_result) return null;
    return new MatchResult(new LabeledValue(this.label, rule_match_result.value), input, rule_match_result.index);
  }
  __impl_toString(visited, next_id) { return `L('${this.label}', ${this.__vivify(this.rule).__toString(visited, next_id)})`; }
}
function label(label, rule) { return new Label(label, rule); }

class NeverMatch extends Rule {
  constructor() { super(); }
  __impl_finalize(indent, visited) { }
  __match(indent, input, index) { return null; }
  __impl_toString(visited, next_id) { return `<NEVER MATCH>`; }
}
const never_match = new NeverMatch();

class Optional extends Rule {
  constructor(rule, default_value = null) {
    super();
    this.rule = make_rule_func(rule);
    this.default_value = default_value;
  }
  __match(indent, input, index) {
    const match_result = this.rule.match(input, index, indent + 1);
    if (match_result === null) {
      return new MatchResult(this.default_value !== null ? [this.default_value] : [], input, index);
    }
    match_result.value = [match_result.value];
    return match_result;
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.rule).__toString(visited, next_id)}?`; }
}
function optional(rule, default_value = null) { return new Optional(rule, default_value); }

class Sequence extends Rule {
  constructor(...elements) {
    super();
    this.elements = elements.map(make_rule_func);
  }
  __fail_or_throw_error(start_rule_result, failed_rule_result, input, index) { return null; }
  __impl_finalize(indent, visited) {
    for (let ix = 0; ix < this.elements.length; ix++) {
      this.elements[ix] = this.__vivify(this.elements[ix]);
      this.elements[ix].__finalize(indent + 1, visited);
    }
  }
  __match(indent, input, index) {
    const start_rule = input[0];
    const start_rule_match_result = this.elements[0].match(input, index, indent + 2);
    let last_match_result = start_rule_match_result;
    if (last_match_result === null) return null;
    const values = [];
    index = last_match_result.index;
    if (last_match_result.value !== DISCARD) values.push(last_match_result.value);
    for (let ix = 1; ix < this.elements.length; ix++) {
      const element = this.elements[ix];
      last_match_result = element.match(input, index, indent + 2);
      if (!last_match_result) return this.__fail_or_throw_error(start_rule_match_result, last_match_result, input, index);
      if (last_match_result.value !== DISCARD) values.push(last_match_result.value);
      index = last_match_result.index;
    }
    return new MatchResult(values, input, last_match_result.index);
  }
  __impl_toString(visited, next_id) { return `(${this.elements.map((x) => this.__vivify(x).__toString(visited, next_id)).join(" ")})`; }
}
function seq(...elements) { return new Sequence(...elements); }

class CuttingSequence extends Sequence {
  constructor(leading_rule, ...expected_rules) { super(leading_rule, ...expected_rules); }
  __fail_or_throw_error(start_rule_result, failed_rule_result, input, index) {
    throw new Error(`expected (${this.elements.slice(1).join(" ")}) after ${this.elements[0]} at char ${input[start_rule_result.index].start}, found: [ ${input.slice(start_rule_result.index).join(", ")} ]`);
  }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.elements[0]).__toString(visited, next_id)}=>${this.elements.slice(1).map(x => this.__vivify(x).__toString(visited, next_id))}`; }
}
function cutting_seq(leading_rule, ...expected_rules) { return new CuttingSequence(leading_rule, ...expected_rules); }

class Xform extends Rule {
  constructor(rule, xform_func) {
    super();
    this.xform_func = xform_func;
    this.rule = make_rule_func(rule);
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(input, index, indent + 1);
    if (!rule_match_result) return null;
    rule_match_result.value = this.xform_func(rule_match_result.value);
    return rule_match_result
  }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.rule).__toString(visited, next_id)}`; }
}
function xform(...things) {
  things = things.map(make_rule_func);
  if (things[0] instanceof Rule || things[0] instanceof RegExp || typeof things[0] === "string" || things[0] instanceof ForwardReference) {
    const fn = pipe_funs(...things.slice(1));
    const rule = things[0];
    return new Xform(rule, fn);
  } else {
    const fn = compose_funs(...things.slice(0, -1));
    const rule = things[things.length - 1];
    return new Xform(rule, fn);
  }
}

class Expect extends Rule {
  constructor(rule, error_func = null) {
    super();
    this.rule = make_rule_func(rule);
    this.error_func = error_func;
  }
  __match(indent, input, index) {
    const match_result = this.rule.match(input, index, indent + 1);
    if (!match_result) {
      if (this.error_func) { throw this.error_func(this, index, input) }
      else { throw new Error(`expected (${this.rule} at char ${input[index].start}, found: [ ${input.slice(index).join(", ")} ]`); }
    };
    return match_result;
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  __impl_toString(visited, next_id) { return `${this.__vivify(this.rule).__toString(visited, next_id)}!`; }
}
function expect(rule, error_func = null) { return new Expect(rule, error_func); }

class Unexpected extends Rule {
  constructor(rule, error_func = null) {
    super();
    this.rule = make_rule_func(rule);
    this.error_func = error_func;
  }
  __match(indent, input, index) {
    const match_result = this.rule.match(input, index, indent + 1);
    if (match_result) {
      if (this.error_func) { throw this.error_func(this, index, input) }
      else { throw new Error(`unexpected (${this.rule} at char ${index}, found: "${input.substring(index, index + 20)}..."`); }
    };
    return null;
  }
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  __impl_toString(visited, next_id) { return `!${this.__vivify(this.rule).__toString(visited, next_id)}!`; }
}
function unexpected(rule, error_func = null) { return new Unexpected(rule, error_func); }

class Fail extends Rule {
  constructor(error_func = null) {
    super();
    this.error_func = error_func;
  }
  __match(indent, input, index) {
    throw this.error_func ? this.error_func(this, index, input) : new Error(`unexpected (${this.rule} at char ${input[index].start}, found: [ ${input.slice(index).join(", ")} ]`);
  }
  __impl_finalize(indent, visited) { }
  __impl_toString(visited, next_id) { return `<FAIL!>`; }
}
function fail(error_func = null) { return new Fail(error_func); }

class TokenLabel extends Rule {
  constructor(label) {
    super();
    this.label = label;
  }
  __impl_finalize(indent, visited) { }
  __match(indent, input, index) {
    if (index_is_at_end_of_input(index, input)) return null;
    let the_token = input[index];
    if (the_token?.label != this.label) return null;
    return new MatchResult(the_token, input, index + 1)
  }
  __impl_toString(visited, next_id) { return `'${this.label}'`; }
}
function tok(label) { return new TokenLabel(label); }

class Literal extends Rule {
  constructor(string) {
    super();
    this.string = string;
  }
  __impl_finalize(indent, visited) { }
  __match(indent, input, index) {
    if (index_is_at_end_of_input(index, input)) return null;
    if (!input.startsWith(this.string, index)) return null;
    return new MatchResult(this.string, input, index + this.string.length)
  }
  __impl_toString(visited, next_id) { return `'${this.string}'`; }
}
function l(first_arg, second_arg) {
  if (second_arg) return new Label(first_arg, new Literal(second_arg));
  return new Literal(first_arg);
}

class Regex extends Rule {
  constructor(regexp) {
    super();
    this.regexp = this.#ensure_RegExp_sticky_flag(regexp);
  }
  #ensure_RegExp_sticky_flag(regexp) {
    return regexp.sticky ? regexp : new RegExp(regexp.source, regexp.flags + 'y');
  }
  __impl_finalize(indent, visited) { }
  __match(indent, input, index) {
    this.regexp.lastIndex = index;
    const match = this.regexp.exec(input);
    if (!match) return null;
    return new MatchResult(match[match.length - 1], input, index + match[0].length);
  }
  __impl_toString(visited, next_id) { return `${this.regexp.source}`; }
}
function r(first_arg, second_arg) {
  if (second_arg) return new Label(first_arg, new Regex(second_arg));
  return new Regex(first_arg);
}

class ForwardReference {
  constructor(func) { this.func = func; }
  __toString() { return "???"; }
  __impl_toString() { return "???"; }
}
const ref = (func) => new ForwardReference(func);

class LabeledValue {
  constructor(label, value) {
    this.label = label;
    this.value = value;
  }
}
class MatchResult {
  constructor(value, input, index) {
    this.value = value;
    this.index = index;
    this.is_finished = index == input.length;
  }
}
function index_is_at_end_of_input(index, input) { return index == input.length }
function maybe_make_TokenLabel_from_string(thing) {
  if (typeof thing === 'string') return new TokenLabel(thing);
  return thing
}
function maybe_make_RE_or_Literal_from_Regexp_or_string(thing) {
  if (typeof thing === 'string') return new Literal(thing);
  else if (thing instanceof RegExp) return new Regex(thing);
  else return thing;
}
let make_rule_func = maybe_make_RE_or_Literal_from_Regexp_or_string
function set_string_input_mode_enabled(state) {
  string_input_mode_enabled = state;
  return make_rule_func = state ? maybe_make_RE_or_Literal_from_Regexp_or_string : maybe_make_TokenLabel_from_string;
}
function set_log_finalize_enabled(state) { return log_finalize_enabled = state; }
function set_log_match_enabled(state) { return log_match_enabled = state; }
function compose_funs(...fns) { return fns.length === 0 ? x => x : pipe_funs(...[...fns].reverse()); }
function pipe_funs(...fns) {
  if (fns.length === 0) return x => x;
  else if (fns.length === 1) return fns[0];
  const [head, ...rest] = fns;
  return rest.reduce((acc, fn) => x => fn(acc(x)), head);
}

// Common Combinators
const alphas = r(/[a-zA-Z_]+/);
const alphacaps = r(/[A-Z_]+/);
const whites_star = r(/\s*/);
const whites_plus = r(/\s+/);
const d_whites_star = discard(whites_star);
const d_whites_plus = discard(whites_plus);
const lws = rule => second(seq(whites_star, rule));
const tws = rule => first(seq(rule, whites_star));
const star_comma_sep = rule => star(rule, /\s*\,\s*/);
const plus_comma_sep = rule => plus(rule, /\s*\,\s*/);
const star_whites_sep = rule => star(rule, whites_plus);
const plus_whites_sep = rule => plus(rule, whites_plus);
const stringlike = quote => r(new RegExp(String.raw`${quote}(?:[^${quote}\\]|\\.)*${quote}`));
const dq_string = stringlike('"');
const sq_string = stringlike("'");
const triple_dq_string = r(/"""(?:[^\\]|\\.|\\n)*?"""/);
const raw_dq_string = r(/r"[^"]*"/);
const template_string = r(/`(?:[^\\`]|\\.)*`/);
const keyword = word => {
  if (word instanceof Regex) return keyword(word.regexp);
  if (word instanceof RegExp) return keyword(word.source);
  return r(new RegExp(String.raw`\b${word}\b`));
};
const lpar = l('(');
const rpar = l(')');
const lbrc = l('{');
const rbrc = l('}');
const lsqr = l('[');
const rsqr = l(']');
const lt = l('<');
const gt = l('>');
const par_enc = rule => cutting_enc(lpar, rule, rpar);
const brc_enc = rule => cutting_enc(lbrc, rule, rbrc);
const sqr_enc = rule => cutting_enc(lsqr, rule, rsqr);
const tri_enc = rule => cutting_enc(lt, rule, gt);
const wse = rule => enc(whites_star, rule, whites_star);
const factor_op = r(/[\/\*\%]/);
const term_op = r(/[\+\-]/);
const pascal_assign_op = l(':=');
const python_exponent_op = l('**');
const python_logic_word = r(/and|or|not|xor/);
const ampersand = l('&');
const asterisk = l('*');
const bang = l('!');
const bslash = l('\\');
const caret = l('^');
const colon = l(':');
const comma = l(',');
const dash_arrow = l('->');
const dot = l('.');
const eq_arrow = l('=>');
const ellipsis = l('...');
const equals = l('=');
const percent = l('%');
const pipe = l('|');
const pound = l('#');
const question = l('?');
const range = l('..');
const semicolon = l(';');
const slash = l('/');
const c_sint = r(/[+-]?\d+/);
const c_uint = r(/\d+/);
const c_bin = r(/0b[01]/);
const c_char = r(/'\\?[^\']'/);
const c_hex = r(/0x[0-9a-f]+/);
const c_octal = r(/0o[0-7]+/);
const c_sfloat = r(/[+-]?\d*\.\d+(e[+-]?\d+)?/i);
const c_ufloat = r(/\d*\.\d+(e[+-]?\d+)?/i);
const c_ident = r(/[a-zA-Z_][0-9a-zA-Z_]*/);
const c_snumber = choice(c_hex, c_octal, c_sfloat, c_sint);
const c_unumber = choice(c_hex, c_octal, c_ufloat, c_uint);
const c_bool = choice('true', 'false');
const c_arith_assign = r(/\+=|\-=|\*=|\/=|\%=/)
const c_bitwise_and = l('&');
const c_bitwise_bool_ops = r(/&&|\|\|/);
const c_bitwise_not = l('~');
const c_bitwise_or = l('|');
const c_bitwise_xor = caret;
const c_ccomparison_op = r(/<=?|>=?|[!=]/);
const c_incr_decr = r(/\+\+|--/);
const c_shift = r(/<<|>>/);
const c_shift_assign = r(/<<=|>>=/);
const c_unicode_ident = r(/[\p{L}_][\p{L}\p{N}_]*/u);
const dot_chain = rule => plus(rule, dot);
const c_line_comment = r(/\/\/[^\n]*/);
const py_line_comment = r(/#[^\n]*/);
const c_block_comment = r(/\/\*[^]*?\*\//);
const ternary = ((cond_rule, then_rule = cond_rule, else_rule = then_rule) => xform(seq(cond_rule, question, then_rule, colon, else_rule), arr => [arr[0], arr[2], arr[4]]));
const kebab_ident = r(/[a-z]+(?:-[a-z0-9]+)*/);
const c_funcall = (fun_rule, arg_rule, open = '(', close = ')', sep = ',') => seq(fun_rule, wst_cutting_enc(open, wst_star(arg_rule, sep), close));
const __make_wst_quantified_combinator = base_combinator => ((rule, sep = null) => base_combinator(wse(rule), sep));
const __make_wst_quantified_combinator_alt = base_combinator => ((rule, sep = null) => lws(base_combinator(tws(rule), sep ? seq(sep, whites_star) : null)));
const __make_wst_seq_combinator = base_combinator => (...rules) => base_combinator(...rules.map(x => lws(x)));
const wst_choice = (...options) => wse(choice(...options));
const wst_star = __make_wst_quantified_combinator(star);
const wst_plus = __make_wst_quantified_combinator(plus);
const wst_star_alt = __make_wst_quantified_combinator_alt(star);
const wst_plus_alt = __make_wst_quantified_combinator_alt(plus);
const wst_seq = __make_wst_seq_combinator(seq);
const wst_enc = __make_wst_seq_combinator(enc);
const wst_cutting_seq = __make_wst_seq_combinator(cutting_seq);
const wst_cutting_enc = __make_wst_seq_combinator(cutting_enc);
const wst_par_enc = rule => cutting_enc(wse(lpar), rule, wse(rpar));
const wst_brc_enc = rule => cutting_enc(wse(lbrc), rule, wse(rbrc));
const wst_sqr_enc = rule => cutting_enc(wse(lsqr), rule, wse(rsqr));
const wst_tri_enc = rule => cutting_enc(wse(lt), rule, wse(gt));
const push = ((value, rule) => xform(rule, arr => [value, ...arr]));
const enclosing = (left, enclosed, right) => xform(arr => [arr[0], arr[2]], seq(left, enclosed, right));

class WildcardPicker {
  constructor(optSpecs = []) {
    this.options = [];
    this.range = 0;
    for (const optSpec of optSpecs) {
      if (Array.isArray(optSpec)) { this.add(...optSpec); } else { this.add(1, optSpec); }
    }
  }
  add(weight, value) {
    this.options.push([weight, value]);
    this.range += weight;
  }
  pick() {
    if (this.options.length == 1) return this.options[0][1];
    let total = 0;
    const random = Math.random() * this.range;
    for (const option of this.options) {
      total += option[0];
      if (random < total) return option[1];
    }
  }
}

const json = choice(() => json_object, () => json_array, () => json_string, () => json_true, () => json_false, () => json_null, () => json_number);
const json_object = xform(arr => Object.fromEntries(arr), wst_cutting_enc('{', wst_star(xform(arr => [arr[0], arr[2]], wst_seq(() => json_string, ':', json)), ','), '}'));
const json_array = wst_cutting_enc('[', wst_star(json, ','), ']');
const json_string = xform(JSON.parse, /"(?:[^"\\\u0000-\u001F]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/);
const json_unicodeEscape = r(/u[0-9A-Fa-f]{4}/);
const json_escape = seq('\\', choice(/["\\/bfnrt]/, json_unicodeEscape));
const json_true = xform(x => true, 'true');
const json_false = xform(x => false, 'false');
const json_null = xform(x => null, 'null');
const json_minus = l('-');
const json_integralPart = r(/0|[1-9][0-9]*/);
const json_fractionalPart = r(/\.[0-9]+/);
const json_exponentPart = r(/[eE][+-]?\d+/);
const reify_json_number = arr => {
  const multiplier = arr[0].length > 0 ? -1 : 1;
  const integer_part = arr[1];
  const fractional_part = arr[2];
  const exponent = arr[3];
  const number = multiplier * ((integer_part + fractional_part) ** exponent);
  return number;
};
const json_number = xform(reify_json_number, seq(optional(json_minus), xform(parseInt, json_integralPart), xform(arr => parseFloat(arr[0]), optional(json_fractionalPart, 0.0)), xform(parseInt, optional(json_exponentPart, 1))));
const json_S = whites_plus;
json.finalize();

const jsonc_comments = wst_star(choice(c_block_comment, c_line_comment));
// FIXED: Changed jsonc_* references to json_* for literals (string, bool, null, number)
const jsonc = second(wst_seq(jsonc_comments, choice(() => jsonc_object, () => jsonc_array, () => json_string, () => json_true, () => json_false, () => json_null, () => json_number), jsonc_comments));
const jsonc_array = wst_cutting_enc('[', wst_star(second(seq(jsonc_comments, jsonc, jsonc_comments)), ','), ']');
const jsonc_object = xform(arr => Object.fromEntries(arr), wst_cutting_enc('{', wst_star(xform(arr => [arr[1], arr[5]], wst_seq(jsonc_comments, () => json_string, jsonc_comments, ':', jsonc_comments, jsonc, jsonc_comments)), ','), '}'));
jsonc.finalize();

function rand_int(x, y) {
  y ||= x;
  const min = Math.min(x, y);
  const max = Math.max(x, y);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pretty_list(arr) {
  const items = arr.map(String);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const ret = `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return ret;
}
function capitalize(string) { return string.charAt(0).toUpperCase() + string.slice(1); }
function choose_indefinite_article(word) {
  if (!word) return 'a';
  const lower = word.toLowerCase();
  const vowelSoundExceptions = [/^e[uw]/, /^onc?e\b/, /^uni([^nmd]|$)/, /^u[bcfhjkqrstn]/, /^uk/, /^ur[aeiou]/,];
  const silentHWords = ['honest', 'honor', 'hour', 'heir', 'herb'];
  if (silentHWords.includes(lower)) return 'an';
  if (vowelSoundExceptions.some(re => re.test(lower))) return 'a';
  if ('aeiou'.includes(lower[0])) return 'an';
  return 'a';
}
function unescape(str) {
  return str.replace(/\\n/g, '\n').replace(/\\ /g, ' ').replace(/\\(.)/g, '$1')
};
function smart_join(arr) {
  arr = [...arr];
  const vowelp = (ch) => "aeiou".includes(ch.toLowerCase());
  const punctuationp = (ch) => "_-,.?!;:".includes(ch);
  const linkingp = (ch) => ch === "_" || ch === "-";
  const whitep = (ch) => ch === ' ' || ch === '\n';
  let left_word = arr[0]?.toString() ?? "";
  let str = left_word;
  for (let ix = 1; ix < arr.length; ix++) {
    let right_word = null;
    let prev_char = null;
    let prev_char_is_escaped = null
    let next_char = null;
    const update_pos_vars = () => {
      right_word = arr[ix]?.toString() ?? "";
      prev_char = left_word[left_word.length - 1] ?? "";
      prev_char_is_escaped = left_word[left_word.length - 2] === '\\';
      next_char = right_word[0] ?? '';
    };
    const shift_left = (n) => {
      const shifted_str = right_word.substring(0, n);
      str = str.substring(0, str.length - 1) + shifted_str;
      left_word = left_word.substring(0, left_word.length - 1) + shifted_str;
      arr[ix] = right_word.substring(n);
      update_pos_vars();
    };
    update_pos_vars();
    if (prev_char === ',' && right_word === ',') continue;
    while (",.!?".includes(prev_char) && right_word.startsWith('...')) shift_left(3);
    while (",.!?".includes(prev_char) && next_char && ",.!?".includes(next_char)) shift_left(1);
    const articleCorrection = (originalArticle, nextWord) => {
      const expected = choose_indefinite_article(nextWord);
      if (originalArticle.toLowerCase() === 'a' && expected === 'an') {
        return originalArticle === 'A' ? 'An' : 'an';
      }
      return originalArticle;
    };
    if (left_word === "a" || left_word.endsWith(" a") || left_word === "A" || left_word.endsWith(" A")) {
      const nextWord = right_word;
      const updatedArticle = articleCorrection(left_word.trim(), nextWord);
      if (updatedArticle !== left_word.trim()) {
        if (left_word === "a" || left_word === "A") {
          str = str.slice(0, -1) + updatedArticle;
          left_word = updatedArticle;
        } else {
          str = str.slice(0, -2) + " " + updatedArticle;
          left_word = updatedArticle;
        }
      }
    }
    if (!(!str || !right_word) && !whitep(prev_char) && !whitep(next_char) && !((linkingp(prev_char) || '(['.includes(prev_char)) && !prev_char_is_escaped) && !(linkingp(next_char) || ')]'.includes(next_char)) && (next_char !== '<' && (!(prev_char === '<' && prev_char_is_escaped))) && !(str.endsWith('\\n') || str.endsWith('\\ ')) && !punctuationp(next_char)) {
      prev_char = ' ';
      str += ' ';
    }
    if (next_char === '<' && right_word !== '<') { right_word = right_word.substring(1); }
    else if (prev_char === '<' && !prev_char_is_escaped) { str = str.slice(0, -1); }
    left_word = right_word;
    str += left_word;
  }
  return unescape(str);
}

class Context {
  constructor({
    flags = new Set(),
    scalar_variables = new Map(),
    named_wildcards = new Map(),
    noisy = false,
    files = [],
    config = {},
    top_file = true,
  } = {}) {
    this.flags = flags;
    this.scalar_variables = scalar_variables;
    this.named_wildcards = named_wildcards;
    this.noisy = noisy;
    this.files = files;
    this.config = config;
    this.top_file = top_file;
  }
  reset_temporaries() {
    this.flags = new Set();
    this.scalar_variables = new Map();
  }
  clone() {
    return new Context({
      flags: new Set(this.flags),
      scalar_variables: new Map(this.scalar_variables),
      named_wildcards: new Map(this.named_wildcards),
      noisy: this.noisy,
      files: [...this.files],
      top_file: this.top_file,
    });
  }
  shallow_copy() {
    return new Context({
      flags: this.flags,
      scalar_variables: this.scalar_variables,
      named_wildcards: this.named_wildcards,
      noisy: this.noisy,
      files: this.files,
      top_file: false,
    });
  }
}

const prelude_text = disable_prelude ? '' : `
@set_gender_if_unset := {!female !male !neuter {3 #female|2 #male|#neuter}}
@gender := {@set_gender_if_unset {?female woman |?male man |?neuter androgyne }}
@pro_3rd_subj := {@set_gender_if_unset {?female she |?male he |?neuter it }}
@pro_3rd_obj := {@set_gender_if_unset {?female her |?male him |?neuter it }}
@pro_pos_adj := {@set_gender_if_unset {?female her |?male his |?neuter its}}
@pro_pos := {@set_gender_if_unset {?female hers |?male his |?neuter its}}
@__digit := {<0|<1|<2|<3|<4|<5|<6|<7|<8|<9}
@__high_digit := {<5|<6|<7|<8|<9}
@random_weight := {:1. @__digit}
@high_random_weight := {:1. @__high_digit}
@pony_score_9 := {score_9,}
@pony_score_8_up := {score_9, score_8_up,}
@pony_score_7_up := {score_9, score_8_up, score_7_up,}
@pony_score_6_up := {score_9, score_8_up, score_7_up, score_6_up,}
@pony_score_5_up := {score_9, score_8_up, score_7_up, score_6_up, score_5_up,}
@pony_score_4_up := {score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up,}
@aris_defaults := {masterpiece, best quality, absurdres, aesthetic, 8k, high depth of field, ultra high resolution, detailed background, wide shot,}
`;

let prelude_parse_result = null;
function load_prelude(into_context = new Context()) {
  if (!prelude_parse_result) {
    const old_log_match_enabled = log_match_enabled;
    log_match_enabled = false;
    prelude_parse_result = Prompt.match(prelude_text);
    log_match_enabled = old_log_match_enabled;
  }
  const ignored = expand_wildcards(prelude_parse_result.value, into_context);
  return into_context;
}

function expand_wildcards(thing, context = new Context()) {
  function walk(thing, context) {
    if (typeof thing === 'string') return thing
    else if (Array.isArray(thing)) {
      const ret = [];
      for (const t of thing) {
        const val = walk(t, context);
        ret.push(val);
      }
      return ret;
    }
    else if (thing instanceof ASTSetFlag) {
      context.flags.add(thing.name);
      return '';
    }
    else if (thing instanceof ASTNamedWildcardReference) {
      const got = context.named_wildcards.get(thing.name);
      if (!got) return `\\<ERROR: NAMED WILDCARD '${thing.name}' NOT FOUND!>`;
      const res = [walk(got, context)];
      if (thing.capitalize) res[0] = capitalize(res[0]);
      const count = rand_int(thing.min_count, thing.max_count);
      for (let ix = 1; ix < count; ix++) {
        let val = walk(got, context);
        for (let iix = 0; iix < (Math.max(5, got.options.length * 2)); iix++) {
          if (!res.includes(val)) break;
          val = walk(got, context);
        }
        res.push(val);
      }
      return thing.joiner == ',' ? res.join(", ") : (thing.joiner == '&' ? pretty_list(res) : res.join(" "));
    }
    else if (thing instanceof ASTScalarReference) {
      let got = context.scalar_variables.get(thing.name) ?? `SCALAR '${thing.name}' NOT FOUND}`;
      if (thing.capitalize) got = capitalize(got);
      return got;
    }
    else if (thing instanceof ASTLatchNamedWildcard) {
      const got = context.named_wildcards.get(thing.name);
      if (!got) return `ERROR: Named wildcard ${thing.name} not found!`;
      if (got instanceof ASTLatchedNamedWildcardedValue) return '';
      const latched = new ASTLatchedNamedWildcardedValue(walk(got, context), got);
      context.named_wildcards.set(thing.name, latched);
      return '';
    }
    else if (thing instanceof ASTUnlatchNamedWildcard) {
      let got = context.named_wildcards.get(thing.name);
      if (!got) return `ERROR: Named wildcard ${thing.name} not found!`;
      if (!(got instanceof ASTLatchedNamedWildcardedValue)) throw new Error(`NOT LATCHED: '${thing.name}'`);
      context.named_wildcards.set(thing.name, got.original_value);
      return '';
    }
    else if (thing instanceof ASTNamedWildcardDefinition) {
      if (context.named_wildcards.has(thing.destination)) console.log(`WARNING: redefining named wildcard '${thing.destination.name}'.`);
      context.named_wildcards.set(thing.destination, thing.wildcard);
      return '';
    }
    else if (thing instanceof ASTLatchedNamedWildcardedValue) { return thing.latched_value; }
    else if (thing instanceof ASTScalarAssignment) {
      const val = walk(thing.source, context);
      context.scalar_variables.set(thing.destination.name, val);
      return '';
    }
    else if (thing instanceof ASTAnonWildcard) {
      const new_picker = new WildcardPicker();
      for (const option of thing.options) {
        let skip = false;
        for (const not_flag of option.not_flags) {
          if (context.flags.has(not_flag.name)) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
        for (const check_flag of option.check_flags) {
          let found = false;
          for (const name of check_flag.names) {
            if (context.flags.has(name)) {
              found = true;
              break;
            }
          }
          if (!found) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
        new_picker.add(option.weight, option.body);
      }
      if (new_picker.options.length == 0) return '';
      const pick = new_picker.pick();
      return smart_join(walk(pick, context).flat(Infinity).filter(s => s !== ''));
    }
    else if (thing instanceof ASTSpecialFunction && thing.directive == 'update-config') {
      if (thing.args.length > 2) throw new Error(`%configure takes 1 or 2 arguments, got ${inspect_fun(thing.args)}`);
      let config = {};
      if (thing.args.length === 2) { config[thing.args[0]] = thing.args[1]; }
      else { config = thing.args[0]; }
      if (typeof config !== 'object') throw new Error(`%configure's argument must be an object, got ${inspect_fun(config)}`);
      context.config = { ...context.config, ...config };
      return '';
    }
    if (thing instanceof ASTSpecialFunction && thing.directive == 'set-config') {
      const config = thing.args[0];
      if (typeof config !== 'object') throw new Error(`%configuration's argument must be an object, got ${inspect_fun(config)}`);
      context.config = config;
      return '';
    }
    else if (thing instanceof ASTSpecialFunction) {
      console.log(`IGNORING ${JSON.stringify(thing)}`);
    }
    else {
      throw new Error(`confusing thing: ` + (typeof thing === 'object' ? thing.constructor.name : typeof thing) + ' ' + inspect_fun(thing));
    }
  }
  return smart_join(walk(thing, context).flat(Infinity).filter(s => s !== ''));
}

// AST Classes
class ASTSetFlag { constructor(name) { this.name = name; } }
class ASTCheckFlag { constructor(names) { this.names = names; } }
class ASTNotFlag { constructor(name, set_immediately) { this.name = name; this.set_immediately = set_immediately; } }
class ASTNamedWildcardReference { constructor(name, joiner, capitalize, min_count, max_count) { this.name = name; this.min_count = min_count; this.max_count = max_count; this.joiner = joiner; this.capitalize = capitalize; } }
class ASTScalarReference { constructor(name, capitalize) { this.name = name; this.capitalize = capitalize; } }
class ASTLatchNamedWildcard { constructor(name) { this.name = name; } }
class ASTUnlatchNamedWildcard { constructor(name) { this.name = name; } }
class ASTNamedWildcardDefinition { constructor(destination, wildcard) { this.destination = destination; this.wildcard = wildcard; } }
class ASTLatchedNamedWildcardedValue { constructor(latched_value, original_value) { this.latched_value = latched_value; this.original_value = original_value; } }
class ASTScalarAssignment { constructor(destination, source) { this.destination = destination; this.source = source; } }
class ASTSpecialFunction { constructor(directive, args) { this.directive = directive; this.args = args; } }
class ASTAnonWildcard { constructor(options) { this.options = options; } }
class ASTAnonWildcardAlternative { constructor(weight, check_flags, not_flags, body) { this.weight = weight; this.check_flags = check_flags; this.not_flags = not_flags; this.body = body; } }

// Grammar
const make_ASTAnonWildcardAlternative = arr => {
  const flags = ([...arr[0], ...arr[2]]);
  const set_flags = flags.filter(f => f instanceof ASTSetFlag);
  const check_flags = flags.filter(f => f instanceof ASTCheckFlag);
  const not_flags = flags.filter(f => f instanceof ASTNotFlag);
  const set_immediately_not_flags = not_flags.filter(f => f.set_immediately).map(f => new ASTSetFlag(f.name));
  return new ASTAnonWildcardAlternative(arr[1][0], check_flags, not_flags, [...set_immediately_not_flags, ...set_flags, ...arr[3]]);
}
const make_ASTFlagCmd = (klass, ...rules) => xform(ident => new klass(ident), second(seq(...rules, ident, /(?=\s|[{|}]|$)/)));
const plaintext = /[^{|}\s]+/;
const low_pri_text = /[\(\)\[\]\,\.\?\!\:\;]+/;
const wb_uint = xform(parseInt, /\b\d+(?=\s|[{|}]|$)/);
const ident = /[a-zA-Z_-][0-9a-zA-Z_-]*\b/;
const comment = discard(choice(c_block_comment, c_line_comment));
const assignment_operator = xform(arr => arr, discard(seq(wst_star(comment), ':=', wst_star(comment))));
const SetFlag = make_ASTFlagCmd(ASTSetFlag, '#');
const CheckFlag = xform(ident => new ASTCheckFlag(ident), second(seq('?', plus(ident, ','), /(?=\s|[{|}]|$)/)))
const MalformedNotSetCombo = unexpected('#!');
const NotFlag = xform((arr => new ASTNotFlag(arr[2], arr[1][0])), seq('!', optional('#'), ident, /(?=\s|[{|}]|$)/));
const TestFlag = choice(CheckFlag, MalformedNotSetCombo, NotFlag);
const tld_fun = arr => new ASTSpecialFunction(...arr);
const make_special_function = rule => xform(tld_fun, c_funcall(second(seq('%', rule)), jsonc));
const SpecialFunctionInclude = make_special_function('include');
const SFUpdateConfiguration = make_special_function('update-config');
const SFSetConfiguration = make_special_function('set-config');
const SpecialFunction = choice(SpecialFunctionInclude, SFUpdateConfiguration, SFSetConfiguration);
const AnonWildcardAlternative = xform(make_ASTAnonWildcardAlternative, seq(wst_star(choice(comment, TestFlag, SetFlag)), optional(wb_uint, 1), wst_star(choice(comment, TestFlag, SetFlag)), () => ContentStar));

// CRITICAL FIX: Allow trailing separators in wildcard sets { a | b | }
const AnonWildcard = xform(arr => new ASTAnonWildcard(arr), brc_enc(new Star(wse(AnonWildcardAlternative), '|', trailing_separator_modes.allowed)));

const NamedWildcardReference = xform(seq(discard('@'), optional('^'), optional(xform(parseInt, /\d+/)), optional(xform(parseInt, second(seq('-', /\d+/)))), optional(/[,&]/), ident), arr => {
  const ident = arr[4];
  const min_ct = arr[1][0] ?? 1;
  const max_ct = arr[2][0] ?? min_ct;
  const join = arr[3][0] ?? '';
  const caret = arr[0][0];
  return new ASTNamedWildcardReference(ident, join, caret, min_ct, max_ct);
});
const NamedWildcardDesignator = second(seq('@', ident));
const NamedWildcardDefinition = xform(arr => new ASTNamedWildcardDefinition(...arr), wst_seq(NamedWildcardDesignator, assignment_operator, AnonWildcard));
const NamedWildcardUsage = xform(seq('@', optional("!"), optional("#"), ident), arr => {
  const [bang, hash, ident, objs] = [arr[1][0], arr[2][0], arr[3], []];
  if (!bang && !hash) return new ASTNamedWildcardReference(ident);
  if (bang) objs.push(new ASTUnlatchNamedWildcard(ident));
  if (hash) objs.push(new ASTLatchNamedWildcard(ident));
  return objs;
});
const ScalarReference = xform(seq(discard('$'), optional('^'), ident), arr => new ASTScalarReference(arr[1], arr[0][0]));
const ScalarAssignmentSource = choice(ScalarReference, NamedWildcardReference, AnonWildcard);
const ScalarAssignment = xform(arr => new ASTScalarAssignment(...arr), wst_seq(ScalarReference, assignment_operator, ScalarAssignmentSource));
const Content = choice(NamedWildcardReference, NamedWildcardUsage, SetFlag, AnonWildcard, comment, ScalarReference, SFUpdateConfiguration, SFSetConfiguration, low_pri_text, plaintext);
const ContentStar = xform(wst_star(Content), arr => arr.flat(1));
const PromptBody = wst_star(choice(SpecialFunction, NamedWildcardDefinition, ScalarAssignment, Content));
const Prompt = xform(arr => arr.flat(Infinity), PromptBody);
Prompt.finalize();

// =====================================================================================
// PART 2: SETTINGS, UI AND MAIN EXECUTION LOOP
// =====================================================================================

// --- UPSCALE / REFINE CONFIGURATION ---
// NOTE: Width, Height, and Seed are now dynamic and will be copied from the base generation
const upscaleConfig = {"aestheticScore":6,"negativeOriginalImageWidth":576,"causalInferencePad":0,"targetImageHeight":1024,"model":"skin_supreme_jibmixrealisticxl_v180_f16.ckpt","loras":[{"mode":"all","file":"add_detail_sdxl_lora_f16.ckpt","weight":0.32000000000000001},{"mode":"all","file":"spo_sdxl___improved_aesthetics_lora_f16.ckpt","weight":0.41999999999999998},{"mode":"all","file":"skin_texture_style_v4_lora_f16.ckpt","weight":0.51000000000000001}],"steps":16,"tiledDiffusion":false,"batchCount":1,"originalImageWidth":1280,"seed":3077355401,"controls":[],"shift":1,"height":1024,"guidanceScale":5,"refinerModel":"","upscalerScaleFactor":0,"tiledDecoding":false,"negativeOriginalImageHeight":512,"zeroNegativePrompt":true,"strength":0.57299999999999995,"clipSkip":2,"cfgZeroStar":false,"faceRestoration":"","seedMode":2,"originalImageHeight":1024,"targetImageWidth":1280,"sampler":12,"hiresFix":false,"negativeAestheticScore":2.5,"batchSize":1,"preserveOriginalAfterInpaint":false,"cropLeft":0,"cropTop":0,"maskBlur":2.5,"sharpness":0,"upscaler":"4x_ultrasharp_f16.ckpt","cfgZeroInitSteps":0,"width":1280,"maskBlurOutset":0};

const fallbackPrompt = "[ A cinematic shot of a {2::cat|dog} in space | A portrait of a {wizard|warrior} ]";
// Clone the current configuration so we can restore it later
const originalGlobalConfig = JSON.parse(JSON.stringify(pipeline.configuration));
const uiPrompt = pipeline.prompts.prompt;

let promptString;
let uiHint = "No specific sequence detected.";

// Detect if the user has already entered a sequence or wildcard
if ((uiPrompt.includes('{') && uiPrompt.includes('}')) || uiPrompt.includes('[')) {
    uiHint = "Wildcards/Photoshoot Sequence detected.";
    promptString = uiPrompt;
} else {
    uiHint = "Using example prompt.";
    promptString = fallbackPrompt;
}

const docString = `FULL WILDCARDS PLUS (ROBUST EDITION + SKIN REFINE)

1. Define Sequence: Enclose prompt in [ ].
2. Define Shots: Separate shots with |.
3. Define Vars: Use @var := { ... } BEFORE the sequence.

Example:
@outfit := {red dress|blue suit|}
[ Shot A wearing @outfit | Shot B wearing @outfit ]

SLIDER 1: Batch Count (Images per shot).
SWITCH 2: Toggle Skin Refine Pass.
SLIDER 3: Skin Refine Strength (0.2 - 0.7). Higher = more AI hallucination/change.
SLIDER 4: Refine Pass Steps (15 - 40).
SLIDERS 5-7: Control individual LoRA weights for the Skin Refine Pass.
AFTER EACH IMAGE: An upscale/refine pass will run automatically if enabled.
`;

// UI Request
const userSelection = requestFromUser("Photoshoot Generator (Full)", "Start", function() {
    return [
        this.section("Settings", uiHint, [
            this.textField(promptString, "Enter prompt...", true, 240),
            this.slider(1, this.slider.fractional(0), 1, 100, "Images to generate per Shot"),
            // Toggle for Skin Refine Pass
            this.switch(true, "Enable Skin Refine Pass"),
            // Slider for Refine Strength (0.2 to 0.7)
            this.slider(0.3, this.slider.fractional(1), 0.2, 0.7, "Refine Strength (0.2 - 0.7)"),
            // Slider for Refine Steps (15 - 40)
            this.slider(20, this.slider.fractional(0), 15, 40, "Refine Pass Steps"),
            // Sliders for individual LoRA weights
            this.slider(0.32, this.slider.fractional(2), 0.2, 0.7, "Add Detail LoRA Weight"),
            this.slider(0.42, this.slider.fractional(2), 0.2, 0.7, "SPO LoRA Weight"),
            this.slider(0.51, this.slider.fractional(2), 0.2, 0.7, "Skin Texture LoRA Weight")
        ]),
        this.section("Variation Settings", "Randomly adjust weights for variety", [
            // Variation Range for LoRAs (e.g. +/- 0.2)
            this.slider(0.0, this.slider.fractional(1), 0, 1, "LoRA Variation Range (+/-)"),
            // Variation Range for Modifiers (e.g. +/- 0.2)
            this.slider(0.0, this.slider.fractional(1), 0, 1, "Modifier Variation Range (+/-)"),
            // Number of possible increments (e.g., 5 means we pick from 5 steps up or down)
            this.slider(10, this.slider.fractional(0), 1, 20, "Variation Increments")
        ]),
        this.section("Instructions", docString, [])
    ];
});

const batchCount = parseInt(userSelection[0][1]);
// Get toggle state
const enableRefinePass = userSelection[0][2];
// Get refine strength value directly
const refineStrengthValue = parseFloat(userSelection[0][3]);
// Get refine steps value
const refineStepsValue = parseInt(userSelection[0][4]);
// Get individual LoRA weights
const addDetailWeight = parseFloat(userSelection[0][5]);
const spoWeight = parseFloat(userSelection[0][6]);
const skinTextureWeight = parseFloat(userSelection[0][7]);

promptString = userSelection[0][0];

// New Variation Settings
const loraVariationRange = parseFloat(userSelection[1][0]);
const modifierVariationRange = parseFloat(userSelection[1][1]);
const variationIncrements = parseInt(userSelection[1][2]);

console.log(`Refine Pass Enabled: ${enableRefinePass}`);
if (enableRefinePass) {
    console.log(`Refine Strength: ${refineStrengthValue}, Steps: ${refineStepsValue}`);
    console.log(`Add Detail LoRA: ${addDetailWeight}, SPO LoRA: ${spoWeight}, Skin Texture LoRA: ${skinTextureWeight}`);
}
console.log(`Variations - LoRA: +/-${loraVariationRange}, Modifiers: +/-${modifierVariationRange}, Steps: ${variationIncrements}`);

console.log("Initializing Full Photoshoot Engine...");

// Helper: Parse the [ Shot 1 | Shot 2 ] structure (Simple String Splitter)
function parsePhotoshootSequence(input) {
    input = input.trim();
    if (input.startsWith('[') && input.endsWith(']')) {
        input = input.substring(1, input.length - 1);
    }
    let shots = [];
    let currentShot = "";
    let braceDepth = 0;

    for (let i = 0; i < input.length; i++) {
        let char = input[i];
        if (char === '{') braceDepth++;
        else if (char === '}') braceDepth--;

        if (char === '|' && braceDepth === 0) {
            if (currentShot.trim()) shots.push(currentShot.trim());
            currentShot = "";
        } else {
            currentShot += char;
        }
    }
    if (currentShot.trim()) shots.push(currentShot.trim());
    return shots;
}

// Function to apply random variation to a weight
function varyWeight(baseWeight, range, increments) {
    if (range <= 0 || increments <= 0) return baseWeight;
    
    // Calculate step size based on range and increments
    // e.g. Range 0.2, increments 5 => step 0.04
    const stepSize = range / increments;
    
    // Pick a random number of steps between -increments and +increments
    // e.g. if increments is 5, we pick random int between -5 and 5.
    const randomStep = Math.floor(Math.random() * (increments * 2 + 1)) - increments;
    
    const variation = randomStep * stepSize;
    return parseFloat((baseWeight + variation).toFixed(2));
}

// Function to find and vary prompt modifiers like (hair:1.2) or (red dress: 0.9)
function varyPromptModifiers(prompt, range, increments) {
    if (range <= 0) return prompt;

    // Regex to find (text:weight) patterns
    // Captures: 1=text, 2=weight
    const regex = /\(([^:]+):([0-9.]+)\)/g;
    
    return prompt.replace(regex, (match, text, weightStr) => {
        let weight = parseFloat(weightStr);
        if (!isNaN(weight)) {
            let newWeight = varyWeight(weight, range, increments);
            // Ensure weight doesn't go below 0 (unless that's desired, usually not for weights)
            if (newWeight < 0) newWeight = 0;
            return `(${text}:${newWeight})`;
        }
        return match;
    });
}

// Initialize the Grammar Engine's Context (Base)
const base_context = load_prelude();
let taskQueue = [];

// DETECT MODE (Smart Splitting)
// We look for the LAST bracketed block that contains a pipe, assuming that is the sequence.
// Everything before it is treated as Preamble (Definitions).

let preamble = "";
let sequenceBlock = "";
let isPhotoshootMode = false;

// Find the start of the sequence [ ... ]
const seqStart = promptString.indexOf('[');
const seqEnd = promptString.lastIndexOf(']');

if (seqStart !== -1 && seqEnd !== -1 && seqEnd > seqStart) {
    isPhotoshootMode = true;
    preamble = promptString.substring(0, seqStart).trim();
    sequenceBlock = promptString.substring(seqStart, seqEnd + 1).trim();
}

if (isPhotoshootMode) {
    // PHOTOSHOOT MODE
    console.log("Mode: Sequence (With Preamble)");
    
    // 1. Load Preamble Definitions into Base Context
    if (preamble.length > 0) {
        console.log("Processing Preamble Definitions...");
        try {
            let result = Prompt.match(preamble);
            if(result) expand_wildcards(result.value, base_context); 
        } catch(e) {
            console.log("Warning: Error parsing preamble definitions. " + e.message);
        }
    }

    // 2. Parse Sequence
    let shots = parsePhotoshootSequence(sequenceBlock);
    console.log(`Found ${shots.length} shots in sequence.`);

    // 3. Build Tasks
    for (let i = 0; i < shots.length; i++) {
        let rawShot = shots[i];
        for (let j = 0; j < batchCount; j++) {
            // Clone context (which now has user definitions)
            let context = base_context.clone();
            
            // Parse the shot
            let result = Prompt.match(rawShot);
            if (result) {
                let finalPrompt = expand_wildcards(result.value, context);
                
                // Capture config (merging base config + grammar config)
                let mergedConfig = Object.assign({}, originalGlobalConfig, context.config);
                
                taskQueue.push({ prompt: finalPrompt, config: mergedConfig });
            } else {
                console.log("Skipping invalid shot: " + rawShot.substring(0, 20) + "...");
            }
        }
    }
} else {
    // STANDARD BATCH MODE
    console.log("Mode: Standard Batch");
    let result = Prompt.match(promptString);
    if (result) {
        for (let i = 0; i < batchCount; i++) {
            let context = base_context.clone();
            let finalPrompt = expand_wildcards(result.value, context);
            let mergedConfig = Object.assign({}, originalGlobalConfig, context.config);
            
            taskQueue.push({ prompt: finalPrompt, config: mergedConfig });
        }
    }
}

// B. Send to Draw Things Pipeline
console.log(`Sending ${taskQueue.length} tasks to generation queue...`);

// Ensure models for upscale are available (basic check, pipeline usually handles downloads if explicit)
// This list is based on your upscale config
const refineModels = [
    "4x_ultrasharp_f16.ckpt", 
    "skin_supreme_jibmixrealisticxl_v180_f16.ckpt",
    "add_detail_sdxl_lora_f16.ckpt",
    "spo_sdxl___improved_aesthetics_lora_f16.ckpt",
    "skin_texture_style_v4_lora_f16.ckpt"
];
if (enableRefinePass) {
    pipeline.downloadBuiltins(refineModels);
}

for (let i = 0; i < taskQueue.length; i++) {
    let task = taskQueue[i];

    // Apply modifier variations to the base prompt
    let variedPrompt = varyPromptModifiers(task.prompt, modifierVariationRange, variationIncrements);

    // Deep Copy Configuration for every shot
    let runConfig = JSON.parse(JSON.stringify(task.config));
    runConfig.seed = -1; // Randomize seed for the initial generation

    // Apply variations to LoRA weights in the BASE generation config
    if (runConfig.loras && runConfig.loras.length > 0) {
        runConfig.loras = runConfig.loras.map(lora => {
            // Only modify if weight exists
            if (lora.weight !== undefined) {
                let newWeight = varyWeight(lora.weight, loraVariationRange, variationIncrements);
                // Clamp weight to sensible range
                if (newWeight < 0) newWeight = 0;
                return { ...lora, weight: newWeight };
            }
            return lora;
        });
    }

    console.log(`Queueing [${i+1}/${taskQueue.length}]: ${variedPrompt.substring(0, 30)}...`);

    // 1. Initial Generation
    console.log(`  > Step 1: Base Generation`);
    pipeline.run({
        configuration: runConfig,
        prompt: variedPrompt // Use the varied prompt
    });

    // 2. Refine / Upscale Pass (CONDITIONAL)
    if (enableRefinePass) {
        console.log(`  > Step 2: Skin Refine / Upscale`);
        
        // Prepare refine configuration
        // FIX: Merge upscale settings into a clone of the full original configuration.
        // This ensures all required internal keys (like 'id', 'hiresFixWidth', etc.) are present.
        let refineConfig = JSON.parse(JSON.stringify(originalGlobalConfig));
        Object.assign(refineConfig, upscaleConfig);

        // Apply dynamic strength from user selection
        refineConfig.strength = refineStrengthValue;
        // Apply dynamic steps from user selection
        refineConfig.steps = refineStepsValue;

        // Apply dimensions and seed from the base run to the refine pass
        refineConfig.width = runConfig.width;
        refineConfig.height = runConfig.height;
        refineConfig.originalImageWidth = runConfig.originalImageWidth || runConfig.width;
        refineConfig.originalImageHeight = runConfig.originalImageHeight || runConfig.height;
        refineConfig.targetImageWidth = runConfig.targetImageWidth || runConfig.width;
        refineConfig.targetImageHeight = runConfig.targetImageHeight || runConfig.height;
        refineConfig.seed = runConfig.seed;

        // Apply variations to LoRA weights in the upscale config
        if (refineConfig.loras && refineConfig.loras.length > 0) {
            refineConfig.loras = refineConfig.loras.map(lora => {
                // Determine weight based on LoRA filename
                let baseWeight = lora.weight;
                if (lora.file === "add_detail_sdxl_lora_f16.ckpt") baseWeight = addDetailWeight;
                else if (lora.file === "spo_sdxl___improved_aesthetics_lora_f16.ckpt") baseWeight = spoWeight;
                else if (lora.file === "skin_texture_style_v4_lora_f16.ckpt") baseWeight = skinTextureWeight;

                // Apply variation
                let newWeight = varyWeight(baseWeight, loraVariationRange, variationIncrements);
                // Clamp weight
                if (newWeight < 0) newWeight = 0;
                
                return { ...lora, weight: newWeight };
            });
        }
        
        // We use the same (varied) prompt for refinement to maintain context
        
        pipeline.run({
            configuration: refineConfig,
            prompt: variedPrompt 
        });
    }

    // Note: pipeline.run is synchronous in the scripting environment, 
    // so the loop will wait for generations to finish before moving to the next task.
}

console.log("All requests sent successfully.");
