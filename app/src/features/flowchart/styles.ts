export const FC_CSS = `.fc{font-family:var(--f-ui);font-size:12.5px}
.fc .fs{fill:var(--panel);stroke:var(--muted);stroke-width:1.3}
.fc .execution-lane rect{fill:var(--soft);fill-opacity:.35;stroke:var(--line);stroke-width:1}
.fc .execution-lane text{fill:var(--ink);font-size:14px;font-weight:600}
.fc .t-start .fs,.fc .t-end .fs{fill:var(--soft);stroke:var(--ink)}
.fc .t-action .fs{stroke:var(--sync)}
.fc .t-decision .fs{stroke:var(--event)}
.fc .t-error .fs{stroke:var(--err);stroke-width:1.6}
.fc .inf .fs{stroke-dasharray:4 3}
.fc .fn>text{fill:var(--ink)}
.fc .fe{fill:none;stroke:var(--muted);stroke-width:1.4}
.fc .fe.inf{stroke-dasharray:4 3}
.fc .fa{fill:var(--muted)}
.fc .fa.on{fill:var(--http)}
.fc .fl rect{fill:var(--bg)}
.fc .fl text{fill:var(--muted);font-size:11px}
.fc .change-new .fs,.fc .fe.change-new{stroke:var(--sync);stroke-dasharray:8 4;stroke-width:2}
.fc .change-modified .fs,.fc .fe.change-modified{stroke:var(--event);stroke-width:3}
.fc .change-removed .fs,.fc .fe.change-removed{stroke:var(--muted);stroke-dasharray:2 4}
.fc .change-removed>text{text-decoration:line-through;fill:var(--muted)}
.fc .t-collapsed .fs{fill:var(--soft);stroke:var(--ink);stroke-width:1.6}
.fc .fs-stack{fill:var(--panel);stroke:var(--muted);stroke-width:1}`;
export const UI_CSS = `.fc .fn{cursor:pointer;outline:none}
.fc .fe-hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke}
.fc .fn:hover .fs{stroke-width:2.2}
.fc .fn.mk .fs{fill:color-mix(in srgb,var(--http) 14%,var(--panel));stroke:var(--http);stroke-width:2.2}
.fc .mk-badge circle{fill:var(--http);stroke:var(--panel);stroke-width:2}
.fc .mk-badge path{fill:none;stroke:var(--panel);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fside-input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:14px;font-weight:600;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);margin:2px 0 10px}
.fside-input:focus{outline:2px solid var(--http);outline-offset:1px}
.fside-rule{border:0;border-top:1px solid var(--line);margin:8px 0 10px}
.flow-member-row{display:flex;align-items:center;gap:.5em}
.flow-member-row .unmark{margin-left:auto;flex:none}
.flow-select-actions{display:flex;gap:.5em;align-items:center;flex-wrap:wrap;margin-top:.5em}
.flow-select-bar [aria-pressed="true"]{background:var(--soft);border-color:var(--ink)}
.diagram-lane-title .lane-name{overflow:hidden;text-overflow:ellipsis;padding:0 2.2em}
.diagram-lane-title .lane-fold{position:absolute;right:.4em;top:50%;transform:translateY(-50%);display:inline-grid;place-items:center;width:1.7em;height:1.7em;padding:0;border-radius:5px}
.diagram-lane-title .lane-fold svg{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.diagram-lane-title .lane-fold[aria-pressed="true"]{background:var(--soft)}
.flow-select-bar{display:flex;gap:.5em;align-items:center;flex-wrap:wrap;padding:.35em .75em;border-bottom:1px solid var(--line)}
.flow-members{margin:.25em 0 .75em;padding-left:1.2em}
.flow-members li{margin:.15em 0}
#fl-expand{margin-bottom:.9em}
.diagram-with-lanes .execution-lane text{visibility:hidden}
.diagram-lane-headings{position:sticky;top:0;z-index:2;min-width:100%;box-sizing:border-box;padding-inline:12px;background:var(--bg);border-bottom:1px solid var(--line)}
.diagram-lane-heading-row{position:relative;margin:0 auto}
.diagram-lane-title.diagram-repo-title{background:var(--soft);border-radius:8px 8px 0 0;font-weight:700;letter-spacing:.01em}
.fc .repo-band rect{fill:none;stroke:var(--line);stroke-width:1.5;stroke-dasharray:5 4}
.fc .repo-band text{font-size:13px;font-weight:700;fill:var(--muted)}
.diagram-lane-title{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px 6px 0 0;font-weight:600;white-space:nowrap}
.fc .fn:focus-visible .fs,.fc .fn.sel .fs{stroke:var(--http);stroke-width:2.6}
.fc .fe.on{stroke:var(--http);stroke-width:2.2}
.fc.hovering .fn:not(.hl):not(.mk),.fc.hovering .fe:not(.hl){opacity:.2}
.fc .fn text{user-select:none;-webkit-user-select:none}
.fc.hovering .fl:not(.hl){opacity:.08}
.fc .fn.hl,.fc .fe.hl,.fc .fl.hl{opacity:1!important}
.fc .fs-ring,.fc .fs-gap{display:none;fill:none;stroke-linejoin:round;pointer-events:none}
.fc .fn.hl-main .fs{stroke:var(--http);stroke-width:2.6}
.fc .fn.hl-main .fs-ring{display:inline;stroke:var(--http);stroke-width:11}
.fc .fn.hl-main .fs-gap{display:inline;stroke:var(--bg);stroke-width:7}
.fc .fe.hl{stroke:var(--http);stroke-width:2.6}
.fc .fl.hl text{fill:var(--ink)}
.flegend .lg{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
.flegend .lg.act{stroke:var(--sync)} .flegend .lg.dec{stroke:var(--event)} .flegend .lg.err{stroke:var(--err)} .flegend .lg.inf{stroke-dasharray:3 2}
`;
