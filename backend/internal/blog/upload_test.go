package blog

import "testing"

func TestDetectAllowedImageUploadTypeSupportsSVG(t *testing.T) {
	t.Parallel()

	contentType, extension, allowed := detectAllowedImageUploadType([]byte(`
		<?xml version="1.0" encoding="UTF-8"?>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		  <circle cx="12" cy="12" r="10" fill="#0f766e" />
		</svg>
	`), "diagram.svg")

	if !allowed {
		t.Fatal("expected svg upload to be allowed")
	}

	if contentType != "image/svg+xml" {
		t.Fatalf("expected svg content type, got %q", contentType)
	}

	if extension != ".svg" {
		t.Fatalf("expected .svg extension, got %q", extension)
	}
}

func TestDetectAllowedImageUploadTypeRejectsNonSVGXML(t *testing.T) {
	t.Parallel()

	_, _, allowed := detectAllowedImageUploadType([]byte(`
		<?xml version="1.0" encoding="UTF-8"?>
		<note><title>plain xml</title></note>
	`), "note.svg")

	if allowed {
		t.Fatal("expected non-svg xml payload to be rejected")
	}
}

func TestDetectAllowedImageUploadTypeKeepsExistingBinaryFormats(t *testing.T) {
	t.Parallel()

	contentType, extension, allowed := detectAllowedImageUploadType([]byte("GIF89a"), "animation.gif")
	if !allowed {
		t.Fatal("expected gif upload to stay allowed")
	}

	if contentType != "image/gif" {
		t.Fatalf("expected gif content type, got %q", contentType)
	}

	if extension != ".gif" {
		t.Fatalf("expected .gif extension, got %q", extension)
	}
}
