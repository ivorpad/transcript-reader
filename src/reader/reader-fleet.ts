import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { FleetAgent, FleetStatus, FleetView, SessionView } from '../types/reader';
import { agentDurationMs, fleetSummary } from '../adapters/claude/fleet';
import { activeOffset, formatDuration } from '../adapters/claude/session';
import { plural, shortId, usd } from './format';
import { sharedStyles } from './styles';

const statusTone = (status: FleetStatus): string => {
  switch (status) {
    case 'stopped':
    case 'failed':
      return 'red';
    case 'running':
    case 'launched':
      return 'blue';
    case 'finished':
      return 'violet';
    default:
      return '';
  }
};

const statusLabel = (agent: FleetAgent): string =>
  agent.status === 'stopped' && agent.note?.includes('stoppedByUser') ? 'stopped by user' : agent.status;

@customElement('reader-fleet')
export class ReaderFleet extends LitElement {
  @property({ attribute: false })
  view!: SessionView;

  @property({ attribute: false })
  fleet!: FleetView;

  @property({ type: String })
  title = '';

  @property({ type: String })
  sessionLabel = '';

  #open(agent: FleetAgent): void {
    this.dispatchEvent(
      new CustomEvent('reader-open-agent', {
        detail: { recordKey: agent.recordKey, entryId: agent.entryId },
        bubbles: true,
        composed: true
      })
    );
  }

  #lane(agent: FleetAgent) {
    const timing = this.view.timing;
    const active = timing.activeMs ?? 0;
    if (agent.startedAt === null || active <= 0) return { left: '0%', width: '2%' };
    const start = activeOffset(timing, agent.startedAt);
    const end = agent.endedAt !== null ? activeOffset(timing, agent.endedAt) : active;
    const left = Math.min(98, (start / active) * 100);
    const width = Math.max(1.5, ((end - start) / active) * 100);
    return { left: `${left.toFixed(1)}%`, width: `${Math.min(width, 100 - left).toFixed(1)}%` };
  }

  render() {
    const fleet = this.fleet;
    const view = this.view;
    if (!fleet || !view) return nothing;
    const summary = fleetSummary(fleet);
    const active = view.timing.activeMs !== null ? formatDuration(view.timing.activeMs) : '—';
    const depths = new Set(fleet.agents.map(agent => agent.depth)).size;

    return html`
      <div class="wrap">
        <div class="h1">The fleet is a view inside the session, not a level above it</div>
        <div class="lede">
          Every agent here exists because an <span class="mono">Agent</span> call in this transcript asked for it,
          so the session stays the unit and this is a second read of it.
          ${fleet.agents.length
            ? html`${plural(fleet.agents.length, 'agent')} at ${plural(depths, 'depth')}: the lanes show when each ran
                against the session's ${active} of active time, the list below carries the same ${fleet.agents.length} in
                spawn order.`
            : html`This session made no Agent call.`}
        </div>

        ${fleet.agents.length
          ? html`
              <div class="lanes">
                <div class="lanes-head">
                  <span class="eyebrow mono">active time · ${active}</span>
                  <span class="spacer"></span>
                  <span class="mono muted small">
                    ${plural(summary.total, 'agent')}${summary.stopped ? ` · ${summary.stopped} stopped` : ''}${summary.failed
                      ? ` · ${summary.failed} failed`
                      : ''}${summary.running ? ` · ${summary.running} running` : ''}
                  </span>
                </div>
                ${fleet.agents.map(agent => {
                  const lane = this.#lane(agent);
                  const duration = agentDurationMs(agent);
                  return html`
                    <div class="lane" @click=${() => this.#open(agent)}>
                      <span class="lane-type mono" style=${`padding-left:${Math.max(0, agent.depth - 1) * 16}px`}
                        >${agent.depth > 1 ? '└ ' : ''}${agent.name ?? agent.type}</span
                      >
                      <div class="track">
                        <div class="bar ${statusTone(agent.status)}" style=${`left:${lane.left};width:${lane.width}`}></div>
                      </div>
                      <span class="lane-status mono ${statusTone(agent.status)}">${statusLabel(agent)}</span>
                      <span class="lane-num mono">${duration !== null ? formatDuration(duration) : '—'}</span>
                      <span class="lane-num mono">${usd(agent.costUSD) ?? '—'}</span>
                    </div>
                  `;
                })}
              </div>
            `
          : nothing}

        <div class="tree">
          <div class="card root edge-ink">
            <div class="card-head">
              <span class="type mono">session ${shortId(view.panels.crumbs.sessionId, 8, 0)}</span>
              <span class="mono muted small">${this.sessionLabel}</span>
              <span class="pill">${view.outcome.state}</span>
            </div>
            <div class="desc">${this.title}</div>
            <div class="card-foot mono">
              <span>${plural(view.ledger.rowCount, 'row')}</span>
              <span>${view.timing.wallMs !== null ? `${formatDuration(view.timing.wallMs)} wall` : ''}${view.timing.activeMs !== null ? ` · ${active} active` : ''}</span>
            </div>
          </div>
          ${fleet.agents.map(agent => {
            const duration = agentDurationMs(agent);
            const tone = statusTone(agent.status);
            return html`
              <div class="card edge-${tone || 'violet'} ${tone}" style=${`margin-left:${agent.depth * 18}px`}>
                <div class="card-head">
                  <span class="type mono ${tone}">${agent.name ? `${agent.name} · ` : ''}${agent.type}</span>
                  ${agent.agentId ? html`<span class="mono muted small">${shortId(agent.agentId, 8, 3)}</span>` : nothing}
                  <span class="pill ${tone}">${statusLabel(agent)}</span>
                  ${agent.worktree ? html`<span class="chip mono">worktree ${agent.worktree}</span>` : nothing}
                  ${agent.model ? html`<span class="chip mono">${agent.model}</span>` : nothing}
                </div>
                <div class="desc">${agent.description || 'No description on the call.'}${agent.note ? html` <span class="muted">${agent.note}</span>` : nothing}</div>
                <div class="card-foot mono">
                  <span>${agent.rowCount !== null ? plural(agent.rowCount, 'row') : 'transcript not loaded'}</span>
                  <span>${usd(agent.costUSD) ?? ''}</span>
                  <span>${duration !== null ? formatDuration(duration) : ''}</span>
                  <span>depth ${agent.depth}${agent.toolUseId ? ` · ${shortId(agent.toolUseId, 10, 3)}` : ''}</span>
                  ${agent.recordKey
                    ? html`<a href="#" @click=${(event: Event) => { event.preventDefault(); this.#open(agent); }}>read transcript</a>`
                    : agent.entryId
                      ? html`<a href="#" @click=${(event: Event) => { event.preventDefault(); this.#open(agent); }}>show the call</a>`
                      : nothing}
                </div>
              </div>
            `;
          })}
        </div>

        <div class="foot">
          Workflow journals hold only <span class="mono">started</span> and <span class="mono">result</span> keyed by
          <span class="mono">agentId</span>, with no timestamps, so the lanes above are drawn from parent-side tool call
          and result times, not from the journals. A journal with no matching tool call marks its agent finished and
          nothing else. Drop the session's folder to load the subagent transcripts and meta files that fill in cost,
          rows and status.
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        overflow-y: auto;
        height: 100%;
      }

      .wrap {
        max-width: 1000px;
        padding: 18px 22px 60px;
      }

      .h1 {
        font-size: var(--title-size);
        line-height: var(--title-line);
        font-weight: 500;
        margin-bottom: 6px;
      }

      .lede,
      .foot {
        font-size: var(--body-size);
        line-height: 1.55;
        color: var(--ink);
        max-width: 88ch;
      }

      .foot {
        margin-top: 20px;
        border-top: 1px solid var(--line);
        padding-top: 14px;
      }

      .small {
        font-size: 11px;
      }

      .lanes {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--paper-raised);
        margin-top: 16px;
        overflow: hidden;
      }

      .lanes-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 9px 13px;
        border-bottom: 1px solid var(--line-soft);
        background: var(--paper-rail);
      }

      .spacer {
        flex: 1 1 auto;
      }

      .lane {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: var(--row-data);
        padding: 4px 13px;
        border-top: 1px solid var(--line-soft);
        cursor: pointer;
      }

      .lane:hover {
        background: var(--paper-sunken);
      }

      .lane-type {
        flex: 0 0 168px;
        min-width: 0;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ink-2);
      }

      .track {
        flex: 1 1 auto;
        min-width: 0;
        height: 14px;
        position: relative;
        background: var(--paper-sunken);
        border-radius: 3px;
      }

      .bar {
        position: absolute;
        top: 0;
        bottom: 0;
        background: var(--violet);
        border-radius: 3px;
      }

      .bar.red {
        background: var(--red);
      }

      .bar.blue {
        background: var(--blue);
      }

      .lane-status {
        flex: 0 0 90px;
        font-size: 11px;
        text-align: right;
        color: var(--ink-3);
      }

      .lane-status.red,
      .type.red {
        color: var(--red);
      }

      .lane-status.blue,
      .type.blue {
        color: var(--blue);
      }

      .lane-num {
        flex: 0 0 52px;
        font-size: 11px;
        color: var(--ink-3);
        text-align: right;
      }

      .tree {
        margin-top: 4px;
      }

      .card {
        border: 1px solid var(--line);
        border-left: 2px solid var(--edge);
        border-radius: 6px;
        background: var(--violet-paper);
        padding: 11px 13px;
        margin-top: 10px;
      }

      .card.root {
        background: var(--paper-raised);
      }

      .card.red {
        background: var(--paper-raised);
      }

      .card-head {
        display: flex;
        align-items: center;
        gap: 4px 9px;
        flex-wrap: wrap;
        margin-bottom: 6px;
        min-width: 0;
      }

      .type {
        font-size: var(--label-size);
        line-height: var(--label-line);
        font-weight: 500;
        color: var(--violet);
      }

      .root .type {
        color: var(--ink);
      }

      .chip {
        display: inline-flex;
        align-items: center;
        height: var(--badge-height);
        font-size: 11px;
        color: var(--ink-3);
        border: 1px solid var(--line);
        border-radius: var(--badge-radius);
        padding: 0 6px;
        background: var(--paper-raised);
      }

      .desc {
        font-size: var(--body-size);
        line-height: 1.5;
        color: var(--ink);
        max-width: 76ch;
      }

      .card-foot {
        display: flex;
        gap: 4px 16px;
        flex-wrap: wrap;
        margin-top: 8px;
        min-width: 0;
        font-size: 12px;
        color: var(--ink-3);
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'reader-fleet': ReaderFleet;
  }
}
