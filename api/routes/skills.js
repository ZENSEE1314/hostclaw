const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

const router = express.Router();

// Available skills catalog
const AVAILABLE_SKILLS = [
  { id: 'web_search', name: 'Web Search', description: 'Search the web for real-time information', icon: '🔍' },
  { id: 'image_gen', name: 'Image Generation', description: 'Generate images from text descriptions', icon: '🎨' },
  { id: 'code_executor', name: 'Code Runner', description: 'Execute code in various languages', icon: '💻' },
  { id: 'file_reader', name: 'File Reader', description: 'Read and analyze uploaded files', icon: '📄' },
  { id: 'calculator', name: 'Calculator', description: 'Advanced mathematical calculations', icon: '🧮' },
  { id: 'translator', name: 'Translator', description: 'Translate text between languages', icon: '🌐' },
  { id: 'weather', name: 'Weather', description: 'Get current weather information', icon: '🌤️' },
  { id: 'news', name: 'News', description: 'Get latest news and updates', icon: '📰' },
  { id: 'reminders', name: 'Reminders', description: 'Set and manage reminders', icon: '⏰' },
  { id: 'email', name: 'Email', description: 'Send and manage emails', icon: '📧' }
];

// Get available skills
router.get('/catalog', authenticate, async (req, res, next) => {
  try {
    res.json({ skills: AVAILABLE_SKILLS });
  } catch (error) {
    next(error);
  }
});

// Get user's installed skills
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const installedSkills = user.skills || [];
    
    // Merge with catalog info
    const enrichedSkills = installedSkills.map(skill => {
      const catalogSkill = AVAILABLE_SKILLS.find(s => s.id === skill.id);
      return { ...catalogSkill, ...skill };
    });
    
    res.json({ skills: enrichedSkills });
  } catch (error) {
    next(error);
  }
});

// Install a skill
router.post('/install', authenticate, async (req, res, next) => {
  try {
    const { skillId, config } = req.body;
    
    const skill = AVAILABLE_SKILLS.find(s => s.id === skillId);
    if (!skill) {
      return res.status(400).json({ error: 'Skill not found' });
    }

    await User.addSkill(req.user.userId, {
      id: skillId,
      config: config || {},
      installed_at: new Date(),
      active: true
    });

    res.json({ message: `${skill.name} installed successfully`, skill });
  } catch (error) {
    next(error);
  }
});

// Uninstall a skill
router.delete('/:skillId', authenticate, async (req, res, next) => {
  try {
    await User.removeSkill(req.user.userId, req.params.skillId);
    res.json({ message: 'Skill removed' });
  } catch (error) {
    next(error);
  }
});

// Toggle skill active/inactive
router.patch('/:skillId/toggle', authenticate, async (req, res, next) => {
  try {
    await User.toggleSkill(req.user.userId, req.params.skillId);
    res.json({ message: 'Skill status updated' });
  } catch (error) {
    next(error);
  }
});

// Update skill config
router.patch('/:skillId/config', authenticate, async (req, res, next) => {
  try {
    const { config } = req.body;
    await User.updateSkillConfig(req.user.userId, req.params.skillId, config);
    res.json({ message: 'Skill configuration updated' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
