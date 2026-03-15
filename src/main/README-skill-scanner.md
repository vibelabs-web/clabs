# Skill Scanner

## Overview

`SkillScanner` is a module that scans the `~/.claude/skills/` directory and extracts metadata from `SKILL.md` files using YAML frontmatter parsing.

## Features

- **Scan Skills Directory**: Automatically scans `~/.claude/skills/` and discovers all installed skills
- **Parse SKILL.md**: Extracts metadata from YAML frontmatter (name, description, trigger, category, version, author)
- **Categorization**: Groups skills by category field
- **Reference Files**: Lists reference documentation files in `references/` subdirectory
- **Caching**: Caches scanned skills for efficient repeated access

## Installation

```typescript
import { getSkillScanner } from '@main/skill-scanner';
```

## Usage

### Basic Scanning

```typescript
const scanner = getSkillScanner();
const skills = await scanner.scan();

console.log(`Found ${skills.length} skills`);
for (const skill of skills) {
  console.log(`${skill.name} - ${skill.trigger}`);
}
```

### Get Specific Skill

```typescript
const autoOrchestrate = scanner.getSkillByName('auto-orchestrate');
if (autoOrchestrate) {
  console.log(autoOrchestrate.description);
}
```

### Categorize Skills

```typescript
const categorized = scanner.categorize(skills);
for (const [category, categorySkills] of Object.entries(categorized)) {
  console.log(`${category}: ${categorySkills.length} skills`);
}
```

### Get Reference Files

```typescript
const references = scanner.getReferences('auto-orchestrate');
console.log(`References: ${references.join(', ')}`);
```

## API Reference

### `SkillScanner`

#### Constructor

```typescript
constructor(skillsDir?: string)
```

- `skillsDir`: Optional custom skills directory path. Defaults to `~/.claude/skills`

#### Methods

##### `scan(): Promise<SkillInfo[]>`

Scans the skills directory and returns array of skill information.

**Returns**: Array of `SkillInfo` objects

##### `parseSkillMd(content: string): SkillMetadata | null`

Parses SKILL.md content and extracts YAML frontmatter.

**Parameters**:
- `content`: Raw SKILL.md file content

**Returns**: `SkillMetadata` object or `null` if parsing fails

##### `categorize(skills: SkillInfo[]): Record<string, SkillInfo[]>`

Groups skills by category field.

**Parameters**:
- `skills`: Array of SkillInfo objects

**Returns**: Object with category as key and array of skills as value

##### `getSkillByName(name: string): SkillInfo | undefined`

Retrieves a specific skill by name.

**Parameters**:
- `name`: Skill name

**Returns**: `SkillInfo` object or `undefined` if not found

##### `getReferences(skillPath: string): string[]`

Gets list of reference markdown files for a skill.

**Parameters**:
- `skillPath`: Skill directory name

**Returns**: Array of reference file names

##### `getSkillsDir(): string`

Returns the absolute path to the skills directory.

## Types

### `SkillMetadata`

```typescript
interface SkillMetadata {
  name: string;
  description: string;
  trigger: string;
  category?: string;
  version?: string;
  author?: string;
}
```

### `SkillInfo`

```typescript
interface SkillInfo extends SkillMetadata {
  path: string;  // Relative path from skills directory
}
```

## SKILL.md Format

Skills must have a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: example-skill
description: Example skill description
trigger: /example
category: Workflow
version: 1.0.0
author: Claude Labs
---

# Example Skill

Skill documentation here...
```

### Required Fields

- `name`: Unique skill identifier
- `description`: Brief description of the skill
- `trigger`: Command to invoke the skill (e.g., `/example`)

### Optional Fields

- `category`: Skill category for grouping (defaults to "기타")
- `version`: Skill version number
- `author`: Skill author name

## Testing

Run tests:

```bash
npm run test:main -- skill-scanner
```

## Example Output

Running the example script:

```bash
node dist/main/src/main/examples/test-skill-scanner.js
```

Output:

```
🔍 Scanning skills directory...

✅ Found 18 skills

📋 All Skills:
────────────────────────────────────────────────────────────────────────────────

📦 auto-orchestrate
   Description: TASKS.md를 분석하여 의존성 기반 자동 실행
   Trigger: /orchestrate
   Category: Workflow
   Path: auto-orchestrate
   References: workflow.md, examples.md

📦 cost-router
   Description: AI 비용 최적화 라우팅
   Trigger: /cost-router
   Category: Utility
   Path: cost-router
   References: tier-classification.md

...

📁 Skills by Category:
────────────────────────────────────────────────────────────────────────────────

🏷️  Workflow (5)
   • auto-orchestrate - /orchestrate
   • ultra-thin-orchestrate - /auto-orchestrate --ultra-thin
   ...
```

## Implementation Details

- **No External Dependencies**: Uses only Node.js built-in `fs`, `path`, and `os` modules
- **Error Handling**: Gracefully handles missing files, corrupted YAML, and invalid directories
- **Performance**: Caches scanned skills to avoid repeated file I/O
- **Simple YAML Parser**: Custom lightweight YAML parser for frontmatter (only supports key-value pairs)

## Related Modules

- `ConfigStore`: Application configuration storage
- `LicenseStore`: License validation storage
- `UpdateManager`: Application update management
