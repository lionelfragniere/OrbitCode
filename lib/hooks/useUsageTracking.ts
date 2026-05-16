/* OrbitCode — Usage tracking hook
 * Tracks per-request token usage and costs in session memory.
 */

import { useState, useCallback } from 'react';
import { UsageRecord, UsageSummary, calculateCost } from '@/lib/models';

export function useUsageTracking() {
  const [records, setRecords] = useState<UsageRecord[]>([]);

  const trackUsage = useCallback((record: Omit<UsageRecord, 'id' | 'estimatedCostUsd'>) => {
    const newRecord: UsageRecord = {
      ...record,
      id: `usage-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      estimatedCostUsd: calculateCost(record.model, record.inputTokens, record.outputTokens),
    };
    setRecords((prev) => [...prev, newRecord]);
    return newRecord;
  }, []);

  const getSummary = useCallback((): UsageSummary => {
    const summary: UsageSummary = {
      totalRequests: records.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      byModel: {},
    };

    for (const r of records) {
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;
      summary.totalTokens += r.totalTokens;
      summary.totalCostUsd += r.estimatedCostUsd;

      if (!summary.byModel[r.model]) {
        summary.byModel[r.model] = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      }
      summary.byModel[r.model].requests++;
      summary.byModel[r.model].inputTokens += r.inputTokens;
      summary.byModel[r.model].outputTokens += r.outputTokens;
      summary.byModel[r.model].costUsd += r.estimatedCostUsd;
    }

    return summary;
  }, [records]);

  const clearUsage = useCallback(() => setRecords([]), []);

  return { records, trackUsage, getSummary, clearUsage };
}
