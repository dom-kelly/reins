import { expect, test } from 'vitest'
import type { Verdict } from './merge-policy.ts'
import {
	desiredLabels,
	prStatus,
	statusComment,
	statusMarker,
} from './pr-status.ts'

const base = { lines: [], pr: '7', repo: 'o/r' }

test('a parked verdict is the owner’s; everything else is the agent’s', () => {
	const parked: Verdict = {
		...base,
		allowed: false,
		parked: true,
		risk: 'high',
		authority: 'owner',
		reason: 'all reviewers done',
		message:
			'Merge needs the user (high risk, all reviewers done): hand PR #7 to the user.',
	}
	expect(prStatus(parked)).toEqual({
		state: 'needs-owner',
		summary:
			'**Needs owner.** high risk, all reviewers done; `policy.authority.high` is `owner`. Merge with `gh pr merge 7 --squash --delete-branch`, or comment what to change.',
	})
	expect(desiredLabels(parked)).toEqual(['needs-owner', 'risk:high'])

	const allowed: Verdict = {
		...base,
		allowed: true,
		risk: 'low',
		authority: 'agent',
		reason: 'CI green',
		message: 'policy: low risk, CI green — agent may merge.',
	}
	expect(prStatus(allowed)).toEqual({
		state: 'agent-merges',
		summary:
			'**Agent merges.** low risk, CI green. Nothing needed from the owner.',
	})
	expect(desiredLabels(allowed)).toEqual(['agent-merges', 'risk:low'])

	const waiting: Verdict = {
		...base,
		allowed: false,
		risk: 'medium',
		waiting: 'Cursor Bugbot to pass (risk=medium)',
		message:
			'Merge refused: waiting for Cursor Bugbot to pass (risk=medium). See docs/contributing/shipping-policy.md.',
	}
	expect(prStatus(waiting).summary).toBe(
		'**Agent merges.** Waiting for Cursor Bugbot to pass (risk=medium). Nothing needed from the owner.',
	)

	// Refused before the risk is known: a state label, no risk label.
	const refused: Verdict = {
		...base,
		allowed: false,
		reason: 'PR #7 is a draft',
		message:
			'Merge refused: PR #7 is a draft. See docs/contributing/shipping-policy.md.',
	}
	expect(prStatus(refused).summary).toBe(
		'**Agent merges.** Not yet: PR #7 is a draft. The agent is on it; nothing needed from the owner.',
	)
	expect(desiredLabels(refused)).toEqual(['agent-merges'])
})

test('an owner tier is the owner’s before it is green: needs-owner, not yet mergeable', () => {
	const waiting: Verdict = {
		...base,
		allowed: false,
		risk: 'high',
		authority: 'owner',
		waiting: 'coderabbitai to review 5434499',
		reason: 'waiting for coderabbitai to review 5434499',
		message:
			'Merge refused: waiting for coderabbitai to review 5434499. See docs/contributing/shipping-policy.md.',
	}
	expect(prStatus(waiting)).toEqual({
		state: 'needs-owner',
		summary:
			'**Needs owner, not yet mergeable.** high risk, waiting for coderabbitai to review 5434499. The owner merges once the policy passes.',
	})
	expect(desiredLabels(waiting)).toEqual(['needs-owner', 'risk:high'])

	const refused: Verdict = {
		...waiting,
		waiting: undefined,
		reason: 'review finding(s) from dom-kelly not addressed',
		message:
			'Merge refused: review finding(s) from dom-kelly not addressed. See docs/contributing/shipping-policy.md.',
	}
	expect(prStatus(refused).summary).toBe(
		'**Needs owner, not yet mergeable.** high risk, not yet: review finding(s) from dom-kelly not addressed; the agent is on it. The owner merges once the policy passes.',
	)

	const timedOut: Verdict = { ...waiting, timedOut: true }
	expect(prStatus(timedOut).summary).toBe(
		'**Needs owner, not yet mergeable.** high risk, the agent stopped waiting for coderabbitai to review 5434499; it re-runs the policy when it returns. The owner merges once the policy passes.',
	)
})

test('a timed-out wait on an agent tier says so and stays the agent’s', () => {
	const timedOut: Verdict = {
		...base,
		allowed: false,
		risk: 'medium',
		authority: 'agent',
		waiting: 'Cursor Bugbot to pass (risk=medium)',
		timedOut: true,
		message:
			'policy: gave up after 1200s, still waiting for Cursor Bugbot to pass (risk=medium).',
	}
	expect(prStatus(timedOut)).toEqual({
		state: 'agent-merges',
		summary:
			'**Agent merges.** Stopped waiting for Cursor Bugbot to pass (risk=medium) (timed out); the agent re-runs the policy when it returns. Nothing needed from the owner.',
	})
})

test('the status comment starts with the marker so it can be found and updated', () => {
	const comment = statusComment({
		...base,
		allowed: true,
		risk: 'low',
		message: 'policy: low risk, CI green — agent may merge.',
	})
	expect(comment.split('\n')[0]).toBe(statusMarker)
	expect(comment.split('\n')[1]).toBe('## Shipping policy')
	expect(comment).toContain('**Agent merges.**')
	expect(comment).toContain('`needs-owner` / `agent-merges` / `risk:<tier>`')
})
