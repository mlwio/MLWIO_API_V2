import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import type { ContentItem } from "@shared/schema";

export default function PlayerPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();

  const { data: item, isLoading, error } = useQuery<ContentItem>({
    queryKey: ['/api/content', id],
    enabled: !!id,
  });

  const videoUrl = item?.driveLink || '';

  useEffect(() => {
    if (videoUrl) {
      console.log("Playing Video URL:", videoUrl);
    }
  }, [videoUrl]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading video...</p>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Failed to load video</p>
          <Button onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="mb-4">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/dashboard')}
            data-testid="button-back-to-dashboard"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>

        <div className="bg-card rounded-lg shadow-lg p-6 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground" data-testid="text-video-title">
              {item.title}
            </h1>
            <p className="text-muted-foreground">
              {item.category} {item.releaseYear && `• ${item.releaseYear}`}
            </p>
          </div>

          <div className="aspect-video bg-black rounded-lg overflow-hidden shadow-2xl">
            {videoUrl ? (
              <video
                src={videoUrl}
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

          {videoUrl && (
            <Button
              onClick={() => {
                console.log("Download Video URL:", videoUrl);
                window.open(videoUrl, '_blank');
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
      </div>
    </div>
  );
}
