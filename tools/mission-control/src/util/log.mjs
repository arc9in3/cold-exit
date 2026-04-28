// Pretty console logging with bot-tagged prefixes. Cheap ANSI colors,
// degrades to plain text if the terminal doesn't support them.

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const BOT_COLORS = {
  mc: COLORS.cyan,
  claudie: COLORS.magenta,
  newsie: COLORS.blue,
  thinkie: COLORS.yellow,
  sortie: COLORS.green,
  wrenchy: COLORS.cyan,
  sage: COLORS.cyan,
  db: COLORS.gray,
  cron: COLORS.gray,
  discord: COLORS.gray,
};

function _ts() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function _emit(stream, tag, msg) {
  const color = BOT_COLORS[tag] || COLORS.gray;
  stream.write(`${COLORS.dim}${_ts()}${COLORS.reset} ${color}[${tag}]${COLORS.reset} ${msg}\n`);
}

export function log(tag, msg) {
  _emit(process.stdout, tag, msg);
}

export function warn(tag, msg) {
  _emit(process.stderr, tag, `${COLORS.yellow}WARN${COLORS.reset} ${msg}`);
}

export function err(tag, msg) {
  _emit(process.stderr, tag, `${COLORS.red}ERROR${COLORS.reset} ${msg}`);
}
