'use client';

import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronUp, Clock, Wrench } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools: string[];
  promptPreview: string;
  lastUpdated: string;
  n8nNodeUrl?: string;
}

interface AgentCardProps {
  agent: AgentInfo;
}

/**
 * AgentCard — displays one agent's info in read-only mode (v1).
 *
 * Shows: name, description, system prompt (collapsible, first 500 chars),
 * tool list as badges, last updated timestamp, and a CTA to edit prompts
 * in the n8n editor.
 *
 * @see Requirements 15.2 — v1 read-only with n8n editor deep link
 */
export function AgentCard({ agent }: AgentCardProps) {
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  const promptTruncated = agent.promptPreview.length > 500;
  const displayPrompt = isPromptOpen
    ? agent.promptPreview
    : agent.promptPreview.slice(0, 500);

  const formattedDate = agent.lastUpdated
    ? new Date(agent.lastUpdated).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown';

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{agent.name}</CardTitle>
            <CardDescription className="mt-1">{agent.description}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Clock className="size-3.5" />
            <span>{formattedDate}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Tool list */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Wrench className="size-3.5" />
            <span>Tools ({agent.tools.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
              <Badge key={tool} variant="secondary" className="text-xs">
                {tool}
              </Badge>
            ))}
          </div>
        </div>

        {/* System prompt (collapsible code block) */}
        <div className="space-y-2">
          <Collapsible open={isPromptOpen} onOpenChange={setIsPromptOpen}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                System Prompt (read-only)
              </span>
              {promptTruncated && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                    {isPromptOpen ? (
                      <>
                        Show less <ChevronUp className="size-3" />
                      </>
                    ) : (
                      <>
                        Show more <ChevronDown className="size-3" />
                      </>
                    )}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>

            <div className="relative">
              <pre className="rounded-md bg-muted/50 border p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {displayPrompt}
                {!isPromptOpen && promptTruncated && (
                  <span className="text-muted-foreground">…</span>
                )}
              </pre>
              <CollapsibleContent>
                {/* Content is handled by the displayPrompt logic above */}
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </CardContent>

      <CardFooter>
        {agent.n8nNodeUrl ? (
          <Button asChild className="gap-2">
            <a
              href={agent.n8nNodeUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              Edit prompts in n8n editor
            </a>
          </Button>
        ) : (
          <Button disabled className="gap-2">
            <ExternalLink className="size-4" />
            Edit prompts in n8n editor
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
