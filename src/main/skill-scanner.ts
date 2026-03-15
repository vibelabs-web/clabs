import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Metadata extracted from SKILL.md frontmatter
 */
export interface SkillMetadata {
  name: string;        // 스킬 이름 (명령어로 사용)
  description: string; // 스킬 설명
  trigger: string;     // 실제 명령어 (폴더명 또는 name)
  category?: string;   // 카테고리
  version?: string;
  author?: string;
}

/**
 * Complete skill information including path
 */
export interface SkillInfo extends SkillMetadata {
  path: string;
}

/**
 * Scans ~/.claude/skills directory and extracts skill information
 */
export class SkillScanner {
  private skillsDir: string;
  private projectDir: string | null = null;
  private cachedSkills: SkillInfo[] = [];

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(os.homedir(), '.claude', 'skills');
  }

  /**
   * Set the project directory for scanning local skills
   */
  setProjectDir(projectDir: string | null): void {
    this.projectDir = projectDir;
  }

  /**
   * Scan a single skills directory
   */
  private scanDirectory(skillsDir: string, source: 'global' | 'local'): SkillInfo[] {
    const skills: SkillInfo[] = [];

    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    try {
      const entries = fs.readdirSync(skillsDir);

      for (const entry of entries) {
        const entryPath = path.join(skillsDir, entry);
        const stat = fs.statSync(entryPath);

        if (!stat.isDirectory()) {
          continue;
        }

        // SKILL.md 또는 skill.md (대소문자 무관)
        let skillMdPath = path.join(entryPath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
          skillMdPath = path.join(entryPath, 'skill.md');
          if (!fs.existsSync(skillMdPath)) {
            continue;
          }
        }

        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const metadata = this.parseSkillMd(content, entry);

          if (metadata) {
            skills.push({
              ...metadata,
              path: entry
            });
          }
        } catch (error) {
          console.error(`Failed to parse ${skillMdPath}:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to scan ${source} skills directory:`, error);
    }

    return skills;
  }

  /**
   * Scan the skills directory and return list of all skills
   * Scans both global (~/.claude/skills) and project local (.claude/skills)
   * @returns Array of SkillInfo objects
   */
  async scan(): Promise<SkillInfo[]> {
    this.cachedSkills = [];
    const seenNames = new Set<string>();

    // 1. 프로젝트 로컬 스킬 먼저 스캔 (우선순위 높음)
    if (this.projectDir) {
      const localSkillsDir = path.join(this.projectDir, '.claude', 'skills');
      console.log('Scanning local skills:', localSkillsDir);
      const localSkills = this.scanDirectory(localSkillsDir, 'local');
      for (const skill of localSkills) {
        if (!seenNames.has(skill.name)) {
          this.cachedSkills.push(skill);
          seenNames.add(skill.name);
        }
      }
    }

    // 2. 전역 스킬 스캔
    console.log('Scanning global skills:', this.skillsDir);
    const globalSkills = this.scanDirectory(this.skillsDir, 'global');
    for (const skill of globalSkills) {
      if (!seenNames.has(skill.name)) {
        this.cachedSkills.push(skill);
        seenNames.add(skill.name);
      }
    }

    console.log(`Total skills found: ${this.cachedSkills.length}`);
    return this.cachedSkills;
  }

  /**
   * Parse SKILL.md content and extract YAML frontmatter
   * @param content - Raw content of SKILL.md file
   * @param folderName - Folder name as fallback for trigger
   * @returns SkillMetadata or null if parsing fails
   */
  parseSkillMd(content: string, folderName?: string): SkillMetadata | null {
    try {
      // Extract YAML frontmatter between ---
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = content.match(frontmatterRegex);

      if (!match) {
        return null;
      }

      const yamlContent = match[1];
      const metadata: any = {};

      // Simple YAML parser for key-value pairs
      const lines = yamlContent.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        if (key && value) {
          metadata[key] = value;
        }
      }

      // Validate required fields
      if (!metadata.name || !metadata.description) {
        return null;
      }

      // 명령어는 name 또는 폴더명 사용 (trigger 필드는 트리거 조건이므로 무시)
      const command = metadata.name || folderName;

      // 카테고리 자동 추론
      const category = metadata.category || this.inferCategory(command, metadata.description);

      return {
        name: metadata.name,
        description: metadata.description,
        trigger: command,  // 실제 명령어
        category: category,
        version: metadata.version,
        author: metadata.author
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 스킬 이름과 설명을 기반으로 카테고리 추론
   */
  private inferCategory(name: string, description: string): string {
    const lowerName = name.toLowerCase();
    const lowerDesc = description.toLowerCase();

    // 기획/설계 관련
    if (['socrates', 'neurion', 'eureka', 'screen-spec', 'tasks-generator', 'reverse'].includes(lowerName) ||
        lowerDesc.includes('기획') || lowerDesc.includes('설계') || lowerDesc.includes('명세')) {
      return '기획';
    }

    // 개발/구현 관련
    if (['project-bootstrap', 'auto-orchestrate', 'orchestrate', 'ralph-loop', 'ultra-thin-orchestrate'].includes(lowerName) ||
        lowerDesc.includes('오케스트') || lowerDesc.includes('자동화') || lowerDesc.includes('개발')) {
      return '개발';
    }

    // 검증/리뷰 관련
    if (['code-review', 'trinity', 'evaluation', 'verification-before-completion', 'powerqa', 'sync'].includes(lowerName) ||
        lowerDesc.includes('검증') || lowerDesc.includes('리뷰') || lowerDesc.includes('테스트') || lowerDesc.includes('품질')) {
      return '검증';
    }

    // 도구/유틸리티
    if (['memory', 'rag', 'deep-research', 'chrome-browser', 'packaging', 'goal-setting'].includes(lowerName) ||
        lowerDesc.includes('도구') || lowerDesc.includes('검색') || lowerDesc.includes('브라우저')) {
      return '도구';
    }

    // 에이전트/통신 관련
    if (['a2a', 'cost-router', 'guardrails', 'reflection', 'reasoning', 'kongkong2'].includes(lowerName) ||
        lowerDesc.includes('에이전트') || lowerDesc.includes('통신') || lowerDesc.includes('라우팅')) {
      return '에이전트';
    }

    // 디자인 관련
    if (['design-linker', 'movin-design-system', 'paperfolio-design', 'vercel-review'].includes(lowerName) ||
        lowerDesc.includes('디자인') || lowerDesc.includes('UI') || lowerDesc.includes('프론트')) {
      return '디자인';
    }

    // 문서화 관련
    if (lowerDesc.includes('문서') || lowerDesc.includes('README')) {
      return '문서화';
    }

    return '기타';
  }

  /**
   * Categorize skills by their category field
   * @param skills - Array of SkillInfo objects
   * @returns Object with category as key and array of skills as value
   */
  categorize(skills: SkillInfo[]): Record<string, SkillInfo[]> {
    const categorized: Record<string, SkillInfo[]> = {};

    for (const skill of skills) {
      const category = skill.category || '기타';

      if (!categorized[category]) {
        categorized[category] = [];
      }

      categorized[category].push(skill);
    }

    return categorized;
  }

  /**
   * Get skill information by name
   * @param name - Skill name
   * @returns SkillInfo or undefined if not found
   */
  getSkillByName(name: string): SkillInfo | undefined {
    return this.cachedSkills.find(skill => skill.name === name);
  }

  /**
   * Get list of reference files for a skill
   * @param skillPath - Path to skill directory (relative to skills dir)
   * @returns Array of reference file names
   */
  getReferences(skillPath: string): string[] {
    const referencesPath = path.join(this.skillsDir, skillPath, 'references');

    if (!fs.existsSync(referencesPath)) {
      return [];
    }

    try {
      const files = fs.readdirSync(referencesPath);
      return files.filter(file => file.endsWith('.md'));
    } catch (error) {
      console.error(`Failed to read references for ${skillPath}:`, error);
      return [];
    }
  }

  /**
   * Get the skills directory path
   * @returns Absolute path to skills directory
   */
  getSkillsDir(): string {
    return this.skillsDir;
  }
}

/**
 * Default skill scanner instance
 */
let defaultScanner: SkillScanner | null = null;

/**
 * Get the default skill scanner instance
 * @returns SkillScanner instance
 */
export function getSkillScanner(): SkillScanner {
  if (!defaultScanner) {
    defaultScanner = new SkillScanner();
  }
  return defaultScanner;
}

/**
 * Reset the default skill scanner instance
 */
export function resetSkillScanner(): void {
  defaultScanner = null;
}
