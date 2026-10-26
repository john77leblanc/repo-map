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
.fc .fn.mk .fs{stroke:var(--sync);stroke-width:2.6;stroke-dasharray:6 3}
.diagram-lane-title .lane-fold{margin-left:.5em;font-size:.75em;padding:0 .4em}
.flow-select-bar{display:flex;gap:.5em;align-items:center;flex-wrap:wrap;padding:.35em .75em;border-bottom:1px solid var(--line)}
.flow-members{margin:.25em 0 .75em;padding-left:1.2em}
.flow-members li{margin:.15em 0}
#fl-expand{margin-bottom:.9em}
.diagram-with-lanes .execution-lane text{visibility:hidden}
.diagram-lane-headings{position:sticky;top:0;z-index:2;min-width:100%;box-sizing:border-box;padding-inline:12px;background:var(--bg);border-bottom:1px solid var(--line)}
.diagram-lane-heading-row{position:relative;margin:0 auto}
.diagram-lane-title{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px 6px 0 0;font-weight:600;white-space:nowrap}
.fc .fn:focus-visible .fs,.fc .fn.sel .fs{stroke:var(--http);stroke-width:2.6}
.fc .fe.on{stroke:var(--http);stroke-width:2.2}
.fc.hovering .fn:not(.hl),.fc.hovering .fe:not(.hl){opacity:.2}
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
