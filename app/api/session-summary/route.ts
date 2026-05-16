/* OrbitCode - Session Summary API */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { generateAiText } from '@/lib/ai/providerClient';
import { resolveModelConfig } from '@/lib/ai/providerStore';
import { getLegacyProjectDataDir, getProjectDataDir } from '@/lib/server/appPaths';

function getChatFile(projectFolder: string) {
  return path.join(getProjectDataDir(projectFolder), 'chat-history.json');
}

function getLegacyChatFile(projectFolder: string) {
  return path.join(getLegacyProjectDataDir(projectFolder), 'chat-history.json');
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectFolder, format } = body;

  if (!projectFolder) {
    return NextResponse.json({ error: 'projectFolder required' }, { status: 400 });
  }

  let messages: Array<{ role: string; content: string; timestamp?: number }> = [];
  try {
    let raw: string;
    try {
      raw = await fs.readFile(getChatFile(projectFolder), 'utf-8');
    } catch {
      raw = await fs.readFile(getLegacyChatFile(projectFolder), 'utf-8');
    }
    const data = JSON.parse(raw);
    messages = data.messages || [];
  } catch {
    return NextResponse.json({ error: 'No chat history found for this project' }, { status: 404 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Chat history is empty' }, { status: 400 });
  }

  const transcript = messages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content.substring(0, 500)}`)
    .join('\n\n');

  const summaryFormat = format || 'session-summary';

  try {
    const promptMap: Record<string, string> = {
      'session-summary': [
        'Generate a concise session summary from this development conversation.',
        'Include: Objective, Key Decisions, Changes Made, Files Modified, Open Items.',
        'Format as clean markdown with headers. Be factual and concise.',
      ].join('\n'),
      'pr-description': [
        'Generate a pull request description from this development conversation.',
        'Include: Summary of changes, Motivation, Key files changed, Testing notes.',
        'Format as clean markdown suitable for a GitHub PR description.',
      ].join('\n'),
      'decision-log': [
        'Extract technical decisions made during this conversation.',
        'Format as a numbered list with: Decision, Rationale, Alternatives considered.',
        'Only include actual decisions, not questions or exploration.',
      ].join('\n'),
    };

    const aiConfig = await resolveModelConfig({ temperature: 0.3, maxOutputTokens: 2048 });
    const systemPrompt = promptMap[summaryFormat] || promptMap['session-summary'];
    const summary = (await generateAiText(
      aiConfig,
      [{ role: 'user', content: `${systemPrompt}\n\n--- TRANSCRIPT ---\n${transcript.substring(0, 15000)}` }],
      'You are a technical documentation assistant. Output clean markdown only.',
    )).trim();

    return NextResponse.json({
      success: true,
      summary,
      format: summaryFormat,
      messageCount: messages.length,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    const basicSummary = [
      '# Session Summary',
      '',
      `**Project:** ${projectFolder.replace(/\\/g, '/').split('/').pop()}`,
      `**Messages:** ${messages.length} (${userMessages.length} user, ${assistantMessages.length} assistant)`,
      firstMsg?.timestamp ? `**Started:** ${new Date(firstMsg.timestamp).toISOString()}` : '',
      lastMsg?.timestamp ? `**Ended:** ${new Date(lastMsg.timestamp).toISOString()}` : '',
      '',
      '## User Requests',
      ...userMessages.slice(0, 10).map((m, i) => `${i + 1}. ${m.content.substring(0, 120)}${m.content.length > 120 ? '...' : ''}`),
      userMessages.length > 10 ? `\n...and ${userMessages.length - 10} more requests` : '',
      '',
      '_Note: AI-powered summary unavailable. Configure an AI provider for enhanced summaries._',
    ].filter(Boolean).join('\n');

    return NextResponse.json({
      success: true,
      summary: basicSummary,
      format: 'basic',
      messageCount: messages.length,
      generatedAt: new Date().toISOString(),
    });
  }
}
