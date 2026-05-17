package blog

import "testing"

func TestSearchTextIndexModelBoostsTitleMatches(t *testing.T) {
	model := searchTextIndexModel()
	if model.Options == nil || model.Options.Name == nil || *model.Options.Name != searchTextIndexName {
		t.Fatalf("expected search index name %q, got %#v", searchTextIndexName, model.Options)
	}

	if !searchTextIndexWeightsMatch(model.Options.Weights) {
		t.Fatalf("expected search index model to carry configured weights, got %#v", model.Options.Weights)
	}

	weights := readSearchTextIndexWeights(model.Options.Weights)
	if weights["title"] <= weights["summary"] {
		t.Fatalf("expected title weight to be greater than summary weight, got %d <= %d", weights["title"], weights["summary"])
	}

	if weights["title"] <= weights["body"] {
		t.Fatalf("expected title weight to be greater than body weight, got %d <= %d", weights["title"], weights["body"])
	}
}

func TestSearchTextIndexWeightsMatchRejectsLegacyEqualWeights(t *testing.T) {
	legacyWeights := map[string]interface{}{
		"title":    int32(1),
		"summary":  int32(1),
		"tags":     int32(1),
		"slug":     int32(1),
		"author":   int32(1),
		"category": int32(1),
		"body":     int32(1),
	}

	if searchTextIndexWeightsMatch(legacyWeights) {
		t.Fatal("expected legacy equal-weight text index to require rebuild")
	}
}