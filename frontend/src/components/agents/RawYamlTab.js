import { useState, useMemo } from 'react';
import yaml from 'js-yaml';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Copy, Download, Upload, CheckCircle2 } from 'lucide-react';

export default function RawYamlTab({ config, onImport }) {
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);

  const yamlStr = useMemo(() => {
    const { last_modified, created_at, ...data } = config;
    try {
      return yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false });
    } catch {
      return '# Error generating YAML';
    }
  }, [config]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yamlStr);
      setCopied(true);
      toast.success('YAML copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.id || 'agent'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML file downloaded');
  };

  const handleImport = () => {
    if (!importText.trim()) {
      toast.error('Paste YAML content first');
      return;
    }
    onImport(importText);
    setImportText('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Live preview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Live YAML Preview</CardTitle>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                data-testid="raw-yaml-copy-button"
                className="h-7 text-xs"
              >
                {copied ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                data-testid="raw-yaml-download-button"
                className="h-7 text-xs"
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[500px] overflow-auto border rounded-lg bg-secondary">
            <pre className="yaml-preview p-4 text-xs leading-6">
              {yamlStr}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Import YAML</CardTitle>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!importText.trim()}
              data-testid="raw-yaml-import-button"
              className="h-7 text-xs"
            >
              <Upload className="w-3 h-3 mr-1" />
              Import
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="Paste YAML configuration here to import and populate the form..."
            className="font-mono text-xs h-[500px] resize-none"
            data-testid="raw-yaml-import-textarea"
          />
        </CardContent>
      </Card>
    </div>
  );
}
