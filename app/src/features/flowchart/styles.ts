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
.fc .fs-stack{fill:var(--panel);stroke:var(--muted);stroke-width:1}
.fc .xp .fs{fill:color-mix(in srgb,var(--ext) 22%,var(--panel))}
.fc .xp-frame{fill:color-mix(in srgb,var(--ext) 4%,transparent);stroke:var(--ext);stroke-width:1.3;stroke-dasharray:6 4;stroke-linejoin:round}
.fc .xp-title rect{fill:var(--bg)}
.fc .xp-title text{fill:var(--ext);font-size:11px;font-weight:600}
.fc .xp-badge circle{fill:var(--ext);stroke:var(--panel);stroke-width:1.5}
.fc .xp-badge path{fill:none;stroke:var(--panel);stroke-width:1.6;stroke-linecap:round}`;
export const UI_CSS = `.fc .fn{cursor:pointer;outline:none}
.fc .fe-hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke}
.fc .fn:hover .fs{stroke-width:2.2}
.fc .fn.mk .fs{fill:color-mix(in srgb,var(--http) 14%,var(--panel));stroke:var(--http);stroke-width:2.2}
.fc .mk-badge circle{fill:var(--http);stroke:var(--panel);stroke-width:2}
.fc .mk-badge path{fill:none;stroke:var(--panel);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fside-input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:14px;font-weight:600;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);margin:2px 0 10px}
.fside-input:focus{outline:2px solid var(--http);outline-offset:1px}
.fside .fside-inside{margin:-4px 0 10px}
.fside-head.sticky + .flow-members{margin-top:10px}
.fside-rule{border:0;border-top:1px solid var(--line);margin:8px 0 10px}
.fside .disclosure-list + .fside-rule{margin-top:14px}
.flow-member-row{display:flex;align-items:center;gap:.5em}
.flow-member-row .unmark{margin-left:auto;flex:none}
.flow-select-actions{display:flex;gap:.5em;align-items:center;flex-wrap:wrap;margin-top:.5em}
.flow-closer h4{margin:0 0 .4em}
.flow-closer .status{min-width:0;overflow-wrap:anywhere}
.flow-closer .status:empty{display:none}
#fl-select-mode[aria-pressed="true"]{background:var(--soft);border-color:var(--ink)}
.flow-members{margin:.25em 0 .75em;padding-left:1.2em}
.flow-members li{margin:.15em 0}
#fl-expand{margin-bottom:.9em}
.diagram-with-lanes .execution-lane text{visibility:hidden}
.diagram-lane-headings{position:sticky;top:0;z-index:2;min-width:100%;box-sizing:border-box;padding-inline:12px;background:var(--bg);border-bottom:1px solid var(--line)}
.diagram-lane-heading-row{position:relative;margin:0 auto}
.diagram-lane-title,.diagram-repo-title{position:absolute;box-sizing:border-box;border:1px solid var(--line);border-bottom:0;white-space:nowrap}
.diagram-lane-title,.diagram-repo-title .repo-row{display:flex;align-items:center;justify-content:center;min-width:0}
.diagram-repo-title .repo-row{position:relative;width:100%}
.diagram-lane-title{background:var(--panel);color:var(--ink);border-radius:6px 6px 0 0;font-size:12.5px;font-weight:600}
.diagram-repo-title{background:var(--soft);color:var(--muted);border-radius:8px 8px 0 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.diagram-lane-headings .lane-name{display:block;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;text-align:center;padding:0 26px;line-height:1.2}
.diagram-lane-headings .lane-fold{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:inline-grid;place-items:center;width:20px;height:20px;padding:0;border-radius:5px;font-size:12px}
.diagram-lane-headings .lane-fold svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.diagram-lane-headings .lane-fold[aria-pressed="true"]{background:var(--soft)}
.diagram-lane-headings .repo-fold{width:18px;height:18px}
.diagram-lane-headings .repo-fold svg{transition:transform .15s}
.diagram-lane-headings .repo-fold[aria-pressed="true"] svg{transform:rotate(-90deg)}
.fc .repo-band rect{fill:none;stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}
.diagram-with-lanes .repo-band text{visibility:hidden}
.fc .repo-band text{font-size:13px;font-weight:700;fill:var(--muted)}
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
:is(.flegend,.fshape) .lg{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
:is(.flegend,.fshape) .lg.act{stroke:var(--sync)} :is(.flegend,.fshape) .lg.dec{stroke:var(--event)} :is(.flegend,.fshape) .lg.err{stroke:var(--err)} :is(.flegend,.fshape) .lg.inf{stroke-dasharray:3 2}
:is(.flegend,.fshape) .lg.xp{fill:color-mix(in srgb,var(--ext) 22%,var(--panel))} :is(.flegend,.fshape) .lg-badge{fill:var(--ext)} :is(.flegend,.fshape) .lg-frame{fill:none;stroke:var(--ext);stroke-dasharray:3 2}
:is(.flegend,.fshape) .lg.se{fill:var(--soft);stroke:var(--ink)}
.cl .fshape{flex:none;width:18px;height:12px;overflow:visible}
.flow-conn .cl{align-items:flex-start;gap:8px;padding:5px 6px}
.flow-conn .cl .fshape{margin-top:3px}
.flow-conn .cl-text{color:var(--ink);overflow:visible;flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.flow-conn .cl-text span{overflow:visible}
.flow-conn .cl-title{display:block;color:var(--ink)}
.flow-conn .cl-title .proposal-badge{display:inline-block;margin-right:6px;vertical-align:1px;font-size:10px;font-weight:600;line-height:1.2;padding:1px 4px}
.flow-conn .cl b{font-family:inherit;font-size:12.5px;white-space:normal;overflow-wrap:anywhere}
/* Arrow under a connection: ── label ──▶, styled like the chart's arrows */
.fl-arrow{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:11.5px;line-height:1}
.fl-arrow-line{flex:none;width:14px;border-top:1.5px solid currentColor}
.fl-arrow-label{white-space:nowrap}
.fl-arrow-head{position:relative;margin-right:6px}
.fl-arrow-head::after{content:"";position:absolute;right:-6px;top:-4.25px;border-left:6px solid currentColor;border-top:3.5px solid transparent;border-bottom:3.5px solid transparent}
.fl-arrow.inf .fl-arrow-line{border-top-style:dashed}
.fl-arrow.change-new{color:var(--sync)}.fl-arrow.change-new .fl-arrow-line{border-top-style:dashed;border-top-width:2px}
.fl-arrow.change-modified{color:var(--event)}.fl-arrow.change-modified .fl-arrow-line{border-top-width:2.5px}
.fl-arrow.change-removed .fl-arrow-line{border-top-style:dotted}.fl-arrow.change-removed .fl-arrow-label{text-decoration:line-through}
.flow-conn ul{gap:2px}
.cl-note{color:var(--muted);font-size:11.5px}
.cl.context{opacity:.75}
.flow-conn .cl-title em{margin-left:6px}
.fc.hovering .xp-frame,.fc.hovering .xp-title{opacity:.35}
.flow-mini{margin:.5em 0;padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}
.flow-mini svg{display:block;width:100%;height:auto;max-height:280px;pointer-events:none}
.flow-members [aria-current="step"]{border-color:var(--http)}
`;
