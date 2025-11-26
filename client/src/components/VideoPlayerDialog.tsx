import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useEffect } from "react";
import type { ContentItem } from "@shared/schema";

interface VideoPlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ContentItem | null;
  videoUrl?: string;
}

export function VideoPlayerDialog({ open, onOpenChange, item, videoUrl }: VideoPlayerDialogProps) {
  if (!item) return null;

  // Use the enriched URL directly from the API (already has Alist signed link)
  const videoSrc = videoUrl || '';

  // Log the video URL for debugging
  useEffect(() => {
    if (videoSrc) {
      console.log("Playing Video URL:", videoSrc);
    }
  }, [videoSrc]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[95vh] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 bg-gradient-to-b from-background to-background/95">
          <DialogTitle className="text-2xl font-bold">
            {item.title}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {item.category} {item.releaseYear && `• ${item.releaseYear}`}
          </p>
        </DialogHeader>
        
        <div className="px-6 pb-6 space-y-4">
          <div className="aspect-video bg-black rounded-lg overflow-hidden shadow-2xl">
            {videoSrc ? (
              <video
                src={videoSrc}
                controls
                autoPlay
                className="w-full h-full"
                data-testid={`video-player-${item._id}`}
                controlsList="nodownload"
              >
                Your browser does not support the video tag.
              </video>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white">
                <p>Video URL not available</p>
              </div>
            )}
          </div>
          
          {videoSrc && (
            <Button
              onClick={() => {
                console.log("Download Video URL:", videoSrc);
                window.open(videoSrc, '_blank');
              }}
              className="w-full"
              size="lg"
              data-testid="button-download-video"
            >
              <Download className="mr-2 h-5 w-5" />
              Download Video
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
