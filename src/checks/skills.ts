import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import {
	listFiles,
	packageRoot,
	readRepoFile,
	type CheckIssue,
	type CheckResult,
} from '../lib/repo.ts'

const maxSkillLines = 250
const maxDescriptionLength = 1024
/** Where a product keeps workflows of its own. */
export const productSkillDirs = ['.claude/skills', '.agents/skills']
/** The harness's skills, shipped as the Claude Code plugin products load from
 *  node_modules (decision 0009). Scanned so this repo checks what it ships;
 *  a product has no such directory. */
export const pluginSkillsDir = 'plugin/skills'
export const skillDirs = [...productSkillDirs, pluginSkillsDir]

export function findSkillIssues(file: string, source: string) {
	const issues: Array<CheckIssue> = []
	const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
	if (!match) {
		return [{ file, message: 'missing YAML frontmatter' }]
	}
	const frontmatter = parse(match[1]!) as Record<string, unknown> | null
	const dirName = path.posix.basename(path.posix.dirname(file))
	if (frontmatter?.name !== dirName) {
		issues.push({ file, message: `frontmatter name must equal "${dirName}"` })
	}
	const description = frontmatter?.description
	if (typeof description !== 'string' || description.trim().length < 40) {
		issues.push({
			file,
			message: 'description must say what the skill does and when to use it',
		})
	} else if (description.length > maxDescriptionLength) {
		issues.push({
			file,
			message: `description over ${maxDescriptionLength} chars`,
		})
	}
	const lineCount = source.split('\n').length
	if (lineCount > maxSkillLines) {
		issues.push({
			file,
			message: `${lineCount} lines (max ${maxSkillLines}); move detail into references/ or docs`,
		})
	}
	return issues
}

/** The names the reins plugin ships, read from this package. */
export function pluginSkillNames(root = packageRoot): Array<string> {
	const dir = path.join(root, pluginSkillsDir)
	if (!existsSync(dir)) return []
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
}

/** A product skill may not take a reins skill's name: the plugin's copy still
 *  loads as `/reins:<name>`, but a bare `/<name>` would run the product's, so
 *  a copied-and-edited harness skill would quietly win (decision 0009). */
export function findShadowedSkills(
	files: ReadonlyArray<string>,
	names: ReadonlyArray<string>,
): Array<CheckIssue> {
	return files.flatMap((file) => {
		const name = path.posix.basename(path.posix.dirname(file))
		return names.includes(name)
			? [
					{
						file,
						message: `"${name}" is a reins skill (/reins:${name}); products do not copy or change harness skills. Delete this folder (reins sync removes the copy the harness once wrote); a different workflow needs a different name.`,
					},
				]
			: []
	})
}

export async function checkSkills(root: string): Promise<CheckResult> {
	const issues: Array<CheckIssue> = []
	const productFiles: Array<string> = []
	for (const dir of skillDirs) {
		const files = await listFiles(root, dir, (f) => f.endsWith('/SKILL.md'))
		if (dir !== pluginSkillsDir) productFiles.push(...files)
		for (const file of files) {
			issues.push(...findSkillIssues(file, await readRepoFile(root, file)))
		}
	}
	issues.push(...findShadowedSkills(productFiles, pluginSkillNames()))
	return {
		name: 'skills',
		issues,
		remediation:
			'A skill is a thin workflow: frontmatter name = folder, a description that says what and when, under 250 lines. The harness skills are /reins:<name> from the plugin; a product skill may not reuse their names.',
	}
}
