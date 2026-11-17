// Shared canvas drawing helpers for the world-space XR panels.
//
// Both the sand-table panel and the real-map panel are one canvas texture each;
// keeping the palette and geometry helpers here keeps the two surfaces visually
// identical without sharing layout code.

export const CANVAS_WIDTH = 1400;
export const CANVAS_HEIGHT = 900;
export const PANEL_WIDTH = 0.98;
export const PANEL_HEIGHT = (PANEL_WIDTH * CANVAS_HEIGHT) / CANVAS_WIDTH;

export const COLORS = {
  paper: '#fbf8ef',
  ink: '#253239',
  softInk: '#52605f',
  muted: '#77817d',
  line: '#d8d2c2',
  header: '#253239',
  blue: '#2f6fd6',
  blueSoft: '#e5edf9',
  orange: '#e7772f',
  orangeSoft: '#fae9dc',
  green: '#32634c',
  button: '#f0ecdf',
  buttonHover: '#e6dfcf',
  white: '#fffdf7',
  disabled: '#d8d2c2',
};

export function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function fitText(context, text, maxWidth, maxLines = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || line === '') {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1].replace(/[.,;:!?]$/, '');
  while (last && context.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** Paint one button face. The caller owns hit-region bookkeeping. */
export function paintButton(context, options) {
  const {
    x,
    y,
    width,
    height,
    label,
    hovered = false,
    selected = false,
    primary = false,
    disabled = false,
    fontSize: requestedSize = 16,
  } = options;

  roundRect(context, x, y, width, height, 12);
  if (disabled) {
    context.fillStyle = COLORS.disabled;
  } else if (primary) {
    context.fillStyle = hovered ? '#172126' : COLORS.ink;
  } else if (selected) {
    context.fillStyle = hovered ? COLORS.buttonHover : COLORS.blueSoft;
    context.strokeStyle = '#a9c2ec';
    context.lineWidth = 2;
  } else {
    context.fillStyle = hovered ? COLORS.buttonHover : COLORS.button;
  }
  context.fill();
  if (selected && !disabled) {
    context.stroke();
  }

  context.fillStyle = disabled
    ? '#918f84'
    : primary
      ? COLORS.white
      : selected
        ? '#26508f'
        : COLORS.ink;

  let fontSize = requestedSize;
  context.font = `650 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const maxWidth = width - 18;
  while (context.measureText(label).width > maxWidth && fontSize > 11) {
    fontSize -= 1;
    context.font = `650 ${fontSize}px system-ui, sans-serif`;
  }
  context.fillText(label, x + width / 2, y + height / 2 + 1);
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
}
