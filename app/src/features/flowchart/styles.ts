export const FC_CSS = `.fc{font-family:var(--f-ui);font-size:12.5px}
.fc .fs{fill:var(--panel);stroke:var(--muted);stroke-width:1.3}
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
.fc .change-removed>text{text-decoration:line-through;fill:var(--muted)}`;
export const UI_CSS = `.fc .fn{cursor:pointer;outline:none}
.fc .fn:hover .fs{stroke-width:2.2}
.fc .fn:focus-visible .fs,.fc .fn.sel .fs{stroke:var(--http);stroke-width:2.6}
.fc .fe.on{stroke:var(--http);stroke-width:2.2}
.fc.picking .fe:not(.on){opacity:.35}
.flegend .lg{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
.flegend .lg.act{stroke:var(--sync)} .flegend .lg.dec{stroke:var(--event)} .flegend .lg.err{stroke:var(--err)} .flegend .lg.inf{stroke-dasharray:3 2}
`;
