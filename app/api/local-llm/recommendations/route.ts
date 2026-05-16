import { NextResponse } from 'next/server';
import os from 'os';

function recommendationTier(totalGb: number) {
  if (totalGb >= 48) return 'high';
  if (totalGb >= 24) return 'balanced';
  return 'small';
}

export async function GET() {
  const totalGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  const tier = recommendationTier(totalGb);
  const recommendations = [
    {
      model: 'qwen3:8b',
      label: 'Fast safe default',
      rank: 1,
      command: 'ollama pull qwen3:8b',
      reason: 'Good coding/general model for local interactive use and modest VRAM.',
      recommended: true,
    },
    {
      model: 'qwen3:14b',
      label: 'Balanced quality',
      rank: 2,
      command: 'ollama pull qwen3:14b',
      reason: 'Better reasoning than 8B while still reasonable on a 64 GB RAM workstation.',
      recommended: tier !== 'small',
    },
    {
      model: 'qwen3-coder:30b',
      label: 'Coding-heavy',
      rank: 3,
      command: 'ollama pull qwen3-coder:30b',
      reason: 'Stronger agentic coding model, but expect slower generation and heavier RAM/VRAM pressure.',
      recommended: tier === 'high',
    },
  ];

  return NextResponse.json({
    hardwareTier: tier,
    memoryGb: totalGb,
    recommendations,
    install: {
      ollama: 'Install Ollama from https://ollama.com/download, then run one of the pull commands.',
      mempalace: 'Install MemPalace with: uv tool install mempalace',
    },
  });
}
