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
		message:
			'Merge refused: PR #7 is a draft. See docs/contributing/shipping-policy.md.',
	}
	expect(prStatus(refused).summary).toBe(
		'**Agent merges.** Not yet: PR #7 is a draft. The agent is on it; nothing needed from the owner.',
	)
	expect(desiredLabels(refused)).toEqual(['agent-merges'])
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
