// The release from change notes (decision 0011): fold `changes/*.md` into
// CHANGELOG.md, write the next version into package.json, package-lock.json
// and the plugin manifest, and delete the notes. Git is left to the caller:
// the release workflow commits, pushes and tags; a person runs this on a
// branch and opens the PR. `--check` prints the plan and changes nothing.
import { applyRelease, planRelease } from '../src/release/release.ts'

const check = process.argv.includes('--check')
const root = process.cwd()
const plan = planRelease(root)
if (!plan) {
	console.log('release: no change notes under changes/; nothing to release')
	process.exit(0)
}
console.log(
	`release: ${plan.from} → ${plan.version} (${plan.kind}) from ${plan.fragments.map((f) => f.file).join(', ')}`,
)
if (check) process.exit(0)
const { files } = applyRelease(root, plan)
console.log(`release: wrote ${files.join(', ')}`)
// The last line is the version, for the workflow to read.
console.log(plan.version)
