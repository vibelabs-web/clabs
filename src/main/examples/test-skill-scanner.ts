/**
 * Example usage of SkillScanner
 *
 * This file demonstrates how to use the SkillScanner to:
 * 1. Scan ~/.claude/skills directory
 * 2. Parse SKILL.md files
 * 3. Categorize skills
 * 4. Get references
 */

import { getSkillScanner } from '../skill-scanner';

async function main() {
  console.log('🔍 Scanning skills directory...\n');

  const scanner = getSkillScanner();
  const skills = await scanner.scan();

  console.log(`✅ Found ${skills.length} skills\n`);

  // Display all skills
  console.log('📋 All Skills:');
  console.log('─'.repeat(80));
  for (const skill of skills) {
    console.log(`\n📦 ${skill.name}`);
    console.log(`   Description: ${skill.description}`);
    console.log(`   Trigger: ${skill.trigger}`);
    console.log(`   Category: ${skill.category || '기타'}`);
    console.log(`   Path: ${skill.path}`);

    // Get references
    const references = scanner.getReferences(skill.path);
    if (references.length > 0) {
      console.log(`   References: ${references.join(', ')}`);
    }
  }

  // Categorize skills
  console.log('\n\n📁 Skills by Category:');
  console.log('─'.repeat(80));
  const categorized = scanner.categorize(skills);
  for (const [category, categorySkills] of Object.entries(categorized)) {
    console.log(`\n🏷️  ${category} (${categorySkills.length})`);
    for (const skill of categorySkills) {
      console.log(`   • ${skill.name} - ${skill.trigger}`);
    }
  }

  // Example: Get specific skill
  console.log('\n\n🎯 Get Specific Skill:');
  console.log('─'.repeat(80));
  const autoOrchestrate = scanner.getSkillByName('auto-orchestrate');
  if (autoOrchestrate) {
    console.log(`\nFound: ${autoOrchestrate.name}`);
    console.log(`Description: ${autoOrchestrate.description}`);
    console.log(`Trigger: ${autoOrchestrate.trigger}`);

    const refs = scanner.getReferences(autoOrchestrate.path);
    console.log(`References: ${refs.length} files`);
  }

  console.log('\n✨ Done!\n');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main };
