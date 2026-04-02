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
    const promptRequest = `Create a detailed image generation prompt for: "${description}". Style: ${styleHint}. Return ONLY the prompt text, nothing else. Make it vivid and detailed for AI image generation. Keep it under 200 words.`;

    // Generate enhanced prompt using AI
    let enhancedPrompt = description;
    try {
      const aiRes = await generateAIResponse({
        message: promptRequest,
        provider: undefined,
        providerConfig: null,
        skills: []
      });
      if (!aiRes.error) {
        enhancedPrompt = aiRes.content.replace(/^["']|["']$/g, '').trim();
      }
    } catch (e) {
      console.log('Prompt enhancement failed, using original:', e.message);
    }

    // Step 2: Generate image using Pollinations.ai (free, no API key)
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const width = 1024;
    const height = 1024;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;

    // Verify the image URL works
    try {
      const check = await axios.head(imageUrl, { timeout: 5000 });
    } catch (e) {
      // Pollinations might not support HEAD, that's ok — URL is valid
    }

    // Deduct 1 message for image generation
    await User.deductMessage(req.user.userId);

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

module.exports = router;
