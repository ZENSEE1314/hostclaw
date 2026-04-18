const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const { generateAIResponse } = require('../services/ai');
const axios = require('axios');

const router = express.Router();
router.use(authenticate);

// Generate AI image using free Pollinations.ai API (no key needed)
router.post('/generate-image', async (req, res, next) => {
  try {
    const { description, style } = req.body;
    if (!description) return res.status(400).json({ error: 'Description is required' });

    // Step 1: Use AI to create a detailed image prompt from user's simple description
    const user = await User.findById(req.user.userId);
    const styleMap = {
      'greeting': 'festive greeting card design, warm colors, celebration theme',
      'product': 'professional product showcase, clean background, commercial photography style',
      'festival': 'cultural festival celebration, vibrant colors, traditional elements',
      'sale': 'eye-catching sale banner, bold typography, discount promotion',
      'social': 'social media post design, modern, engaging, shareable',
      'poster': 'professional poster design, high quality, marketing material'
    };

    const styleHint = styleMap[style] || 'professional marketing material';

    // Skip slow AI-prompt enhancement — just append the style hint directly.
    // This cuts 10-20s of latency and removes a failure mode where the AI model stalls.
    const enhancedPrompt = `${description}, ${styleHint}, high quality, detailed, 4k`;

    // Step 2: Generate image URL via Pollinations.ai (free, no API key)
    // Use 1024x1024 + seed for consistency; model=flux gives sharper results than default.
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const width = 1024;
    const height = 1024;
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=flux&seed=${seed}`;

    // Deduct 1 message for image generation
    await User.deductMessage(req.user.userId);

    // Save to user's image history so they can re-download later
    try {
      const { query } = require('../config/database');
      const crypto = require('crypto');
      const u = await User.findById(req.user.userId);
      let history = [];
      if (u.generated_images) {
        history = Array.isArray(u.generated_images) ? u.generated_images : JSON.parse(u.generated_images || '[]');
      }
      history.unshift({
        id: crypto.randomUUID(),
        image_url: imageUrl,
        prompt: description,
        enhanced_prompt: enhancedPrompt,
        style,
        width, height,
        created_at: new Date().toISOString()
      });
      // Keep last 100
      history = history.slice(0, 100);
      await query(
        'UPDATE users SET generated_images = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(history), req.user.userId]
      );
    } catch (e) {
      console.error('Failed to save image history:', e.message);
    }

    res.json({
      image_url: imageUrl,
      prompt_used: enhancedPrompt,
      original_description: description,
      style,
      width,
      height,
      download_url: imageUrl
    });
  } catch (error) { next(error); }
});

// List user's generated image history
router.get('/history', async (req, res, next) => {
  try {
    const u = await User.findById(req.user.userId);
    let history = [];
    if (u.generated_images) {
      history = Array.isArray(u.generated_images) ? u.generated_images : JSON.parse(u.generated_images || '[]');
    }
    res.json({ history });
  } catch (error) { next(error); }
});

// Delete one image from history
router.delete('/history/:id', async (req, res, next) => {
  try {
    const { query } = require('../config/database');
    const u = await User.findById(req.user.userId);
    let history = [];
    if (u.generated_images) {
      history = Array.isArray(u.generated_images) ? u.generated_images : JSON.parse(u.generated_images || '[]');
    }
    const next = history.filter(h => h.id !== req.params.id);
    await query(
      'UPDATE users SET generated_images = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(next), req.user.userId]
    );
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// Save an edited image (data URL) to history
router.post('/history/save-edit', async (req, res, next) => {
  try {
    const { data_url, source_id, prompt } = req.body;
    if (!data_url) return res.status(400).json({ error: 'data_url is required' });
    if (!data_url.startsWith('data:image/')) return res.status(400).json({ error: 'invalid image data' });

    // Decode base64 data URL and save to /uploads/ so it's served statically by Nginx
    const match = data_url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'malformed data URL' });
    const ext = (match[1] || 'png').toLowerCase();
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'image too large (10MB max)' });

    const path = require('path');
    const fs = require('fs');
    const crypto = require('crypto');
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `edit-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buf);
    const url = `/uploads/${filename}`;

    // Save to history
    const { query } = require('../config/database');
    const u = await User.findById(req.user.userId);
    let history = [];
    if (u.generated_images) {
      history = Array.isArray(u.generated_images) ? u.generated_images : JSON.parse(u.generated_images || '[]');
    }
    history.unshift({
      id: crypto.randomUUID(),
      image_url: url,
      prompt: prompt || 'Edited image',
      enhanced_prompt: '',
      style: 'edited',
      edited_from: source_id || null,
      created_at: new Date().toISOString()
    });
    history = history.slice(0, 100);
    await query(
      'UPDATE users SET generated_images = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(history), req.user.userId]
    );
    res.json({ image_url: url });
  } catch (error) { next(error); }
});

// Generate AI video thumbnail/poster (image-based, video generation placeholder)
router.post('/generate-video', async (req, res) => {
  res.json({
    message: 'Video generation coming soon. For now, use the image generator to create thumbnails and poster frames.',
    suggestion: 'Try generating an image first, then use tools like Canva or CapCut to create videos.'
  });
});

// Auto-generate prompt suggestions based on description
router.post('/suggest-prompt', async (req, res, next) => {
  try {
    const { description, type } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });

    const aiRes = await generateAIResponse({
      message: `Suggest 3 creative image prompts for this business need: "${description}". Type: ${type || 'marketing'}. Return as a JSON array of strings, nothing else. Example: ["prompt 1", "prompt 2", "prompt 3"]`,
      provider: undefined,
      providerConfig: null,
      skills: []
    });

    let suggestions = [description];
    try {
      const parsed = JSON.parse(aiRes.content);
      if (Array.isArray(parsed)) suggestions = parsed;
    } catch (e) {
      suggestions = [aiRes.content];
    }

    res.json({ suggestions });
  } catch (error) { next(error); }
});

// Generate a system prompt from an example conversation or description
router.post('/generate-prompt', async (req, res, next) => {
  try {
    const { example, bot_type, business_name } = req.body;
    if (!example) return res.status(400).json({ error: 'Example text is required' });

    const botTypeHints = {
      personal: 'a personal AI assistant that mimics the user\'s communication style',
      customer_service: `a customer service representative for ${business_name || 'a business'}`,
      sales: `a sales assistant for ${business_name || 'a business'}`
    };

    const hint = botTypeHints[bot_type] || botTypeHints.personal;

    const aiRes = await generateAIResponse({
      message: `Analyze this example and generate a detailed system prompt for an AI chatbot.

The bot should be: ${hint}

EXAMPLE OF HOW THE BOT SHOULD COMMUNICATE:
---
${example.substring(0, 3000)}
---

Based on this example, generate a comprehensive system prompt that instructs the AI to:
1. Match the tone, language, and style shown in the example
2. Use similar vocabulary, sentence structure, and formality level
3. Handle the same types of conversations shown
4. Include specific instructions for greeting, responding, handling questions, and closing conversations

Return ONLY the system prompt text. Do not include any explanation or meta-commentary. Start directly with "You are..." or the instructions.`,
      provider: undefined,
      providerConfig: null,
      skills: []
    });

    if (aiRes.error) {
      return res.status(500).json({ error: 'Failed to generate prompt: ' + aiRes.content });
    }

    res.json({ prompt: aiRes.content });
  } catch (error) { next(error); }
});

module.exports = router;
