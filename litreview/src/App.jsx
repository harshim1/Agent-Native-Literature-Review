import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function App() {
  // Search state
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState('idle');
  const [activeTab, setActiveTab] = useState('landscape'); // landscape, proposal, collaborate

  // Results state
  const [papers, setPapers] = useState([]);
  const [trends, setTrends] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [aiSummary, setAiSummary] = useState('');
  const [grantIntro, setGrantIntro] = useState('');
  const [bigAssumption, setBigAssumption] = useState('');
  const [blindSpotScore, setBlindSpotScore] = useState(null);
  const [crossFieldMethods, setCrossFieldMethods] = useState([]);
  const [latencyMap, setLatencyMap] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [error, setError] = useState('');
  const [paperSummaries, setPaperSummaries] = useState({});
  const [savedPapers, setSavedPapers] = useState(new Set());
  const [searchHistory, setSearchHistory] = useState([]);

  // Filters
  const [yearFilter, setYearFilter] = useState([2015, 2025]);
  const [citationFilter, setCitationFilter] = useState(0);
  const [sortBy, setSortBy] = useState('citations'); // citations, year, relevance
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const extractTerms = async (q) => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Extract 3 short academic search queries from: "${q}". Return ONLY JSON array of 3 strings.`
        }]
      })
    });
    const data = await res.json();
    if (!res.ok || !data.choices?.[0]) throw new Error('Failed to extract terms');
    let content = data.choices[0].message.content.trim();
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    return JSON.parse(content);
  };

  const getTrends = async (topic) => {
    try {
      const res = await fetch(
        `https://api.openalex.org/works?filter=title.search:"${encodeURIComponent(topic)}"&group_by=publication_year&per_page=200`
      );
      const data = await res.json();
      return (data.group_by || [])
        .map(item => ({ year: parseInt(item.key), count: item.count }))
        .sort((a, b) => a.year - b.year)
        .slice(-15);
    } catch {
      return [];
    }
  };

  const searchSemanticScholar = async (query) => {
    try {
      const res = await fetch(
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&fields=title,abstract,authors,year,citationCount,paperId&limit=15`
      );
      const data = await res.json();
      return (data.data || []).filter(p => p.abstract && p.abstract.length > 100);
    } catch {
      return [];
    }
  };

  const searchOpenAlex = async (query) => {
    try {
      const res = await fetch(
        `https://api.openalex.org/works?filter=title.search:"${encodeURIComponent(query)}"&per_page=20&sort=cited_by_count:desc`
      );
      const data = await res.json();
      return (data.results || []).map(work => ({
        title: work.title,
        year: work.publication_year,
        citationCount: work.cited_by_count || 0,
        abstract: work.abstract || 'No abstract available',
        authors: (work.authorships || []).slice(0, 5).map(a => ({ name: a.author?.display_name || 'Unknown' })),
        paperId: work.id
      })).filter(p => p.title && p.year);
    } catch {
      return [];
    }
  };

  const searchPapers = async (query) => {
    // Multi-strategy search: try Semantic Scholar first, then OpenAlex as fallback
    const semanticResults = await searchSemanticScholar(query);

    if (semanticResults.length >= 5) {
      return semanticResults;
    }

    // If Semantic Scholar returns few results, try OpenAlex
    const openalexResults = await searchOpenAlex(query);
    return [...semanticResults, ...openalexResults].slice(0, 20);
  };

  const getGoogleScholarLinks = async (query) => {
    try {
      const res = await fetch('https://google.serper.dev/scholar', {
        method: 'POST',
        headers: {
          'X-API-KEY': import.meta.env.VITE_SERPER_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query, num: 15 })
      });
      const data = await res.json();
      return data.organic || [];
    } catch {
      return [];
    }
  };

  const mergePapersWithLinks = (semanticPapers, scholarResults) => {
    return semanticPapers.map(paper => {
      // Find matching Google Scholar result by title similarity
      const scholarMatch = scholarResults.find(result =>
        result.title?.toLowerCase().includes(paper.title.substring(0, 30).toLowerCase()) ||
        paper.title.toLowerCase().includes(result.title?.substring(0, 30).toLowerCase())
      );

      return {
        ...paper,
        scholarLink: scholarMatch?.link || `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`,
        scholarSnippet: scholarMatch?.snippet || paper.abstract.substring(0, 150)
      };
    });
  };

  const generateAISummary = async (q, paperList) => {
    if (paperList.length === 0) return '';

    const summaryText = paperList.slice(0, 8).map((p, i) =>
      `${i+1}. "${p.title}" (${p.year}, ${p.citationCount} citations)`
    ).join('\n');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `Research topic: "${q}"\n\nKey papers:\n${summaryText}\n\nWrite a 3-paragraph research guide that: 1) Explains the current state of research, 2) Identifies major research themes, 3) Points out critical gaps. Be concise and actionable for researchers.`
        }]
      })
    });

    const data = await res.json();
    if (!res.ok || !data.choices?.[0]) return '';
    return data.choices[0].message.content;
  };

  const analyzeGaps = async (q, paperList) => {
    if (paperList.length === 0) return { gaps: [], biggest_assumption: '' };

    const paperText = paperList.slice(0, 10).map((p, i) =>
      `[${i}] "${p.title}" (${p.year})`
    ).join('\n');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Research field: "${q}"\n\nPapers studied:\n${paperText}\n\nIdentify 3 major research gaps. Return ONLY JSON:\n{"gaps": [{"title": "gap name", "research_question": "specific question", "why_missing": "why not studied", "difficulty": "low|medium|high", "novelty_score": 85}], "biggest_assumption": "what the field assumes without testing"}`
        }]
      })
    });

    const data = await res.json();
    if (!res.ok || !data.choices?.[0]) return { gaps: [], biggest_assumption: '' };
    let content = data.choices[0].message.content.trim();
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    try {
      return JSON.parse(content);
    } catch {
      return { gaps: [], biggest_assumption: '' };
    }
  };

  const findResearchers = async (gapQuestion) => {
    try {
      const res = await fetch(
        `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(gapQuestion.substring(0, 50))}&fields=name,affiliations,paperCount,citationCount&limit=3`
      );
      const data = await res.json();
      return data.data || [];
    } catch {
      return [];
    }
  };

  const findCollaborators = async (gaps, mainTopic) => {
    // Find researchers actively working on identified gaps
    try {
      const collaboratorMap = {};

      for (const gap of gaps.slice(0, 3)) {
        // Search for recent papers on the gap topic
        const papersRes = await fetch(
          `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(gap.research_question)}&fields=authors,year&limit=5`
        );
        const papersData = await papersRes.json();
        const recentPapers = (papersData.data || []).filter(p => p.year >= new Date().getFullYear() - 2);

        // Extract unique authors from recent papers
        const authors = [];
        const seenAuthors = new Set();
        for (const paper of recentPapers) {
          for (const author of (paper.authors || []).slice(0, 3)) {
            const authorName = author.name || author.authorId;
            if (authorName && !seenAuthors.has(authorName)) {
              seenAuthors.add(authorName);
              authors.push({
                name: authorName,
                paperId: paper.paperId,
                year: paper.year
              });
            }
          }
        }

        collaboratorMap[gap.title] = authors.slice(0, 3);
      }

      return collaboratorMap;
    } catch (err) {
      console.error('Error finding collaborators:', err);
      return {};
    }
  };

  const generatePaperSummary = async (paper) => {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: `Summarize this paper in 1 sentence (max 15 words): "${paper.title}". Abstract: ${paper.abstract?.substring(0, 300) || 'N/A'}`
          }]
        })
      });

      const data = await res.json();
      if (!res.ok || !data.choices?.[0]) return '';
      return data.choices[0].message.content.substring(0, 150);
    } catch {
      return '';
    }
  };

  const extractTopics = async (paper) => {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 50,
          messages: [{
            role: 'user',
            content: `Extract 3 main research topics as a JSON array from: "${paper.title}". Return only JSON: ["topic1", "topic2", "topic3"]`
          }]
        })
      });

      const data = await res.json();
      if (!res.ok || !data.choices?.[0]) return [];
      let content = data.choices[0].message.content.trim();
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      return JSON.parse(content);
    } catch {
      return [];
    }
  };

  const toggleSavedPaper = (paperId) => {
    const newSaved = new Set(savedPapers);
    if (newSaved.has(paperId)) {
      newSaved.delete(paperId);
    } else {
      newSaved.add(paperId);
    }
    setSavedPapers(newSaved);
  };

  const generateGrantProposal = async (q, paperList) => {
    if (paperList.length === 0) return '';

    const paperSummary = paperList.slice(0, 6).map(p => `- ${p.title}`).join('\n');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Write an NSF-style grant proposal introduction (3 paragraphs) for research in: "${q}"\n\nKey literature:\n${paperSummary}\n\nMake it compelling, establish the field's importance, and justify the need for new research.`
        }]
      })
    });

    const data = await res.json();
    if (!res.ok || !data.choices?.[0]) return '';
    return data.choices[0].message.content;
  };

  const calculateBlindSpotScore = (paperList, gapList) => {
    if (paperList.length === 0) return 0;

    // Simple, coherent score: ratio of gaps to papers
    // High score = many unexplored areas relative to what's been studied
    // Score represents: percentage of research territory that's unexplored
    const score = Math.min(100, Math.round((gapList.length / Math.max(paperList.length, 1)) * 100));
    return score;
  };

  const findCrossFieldMethods = async (q) => {
    try {
      // Get adjacent fields via OpenAlex
      const res = await fetch(
        `https://api.openalex.org/concepts?filter=display_name.search:"${encodeURIComponent(q)}"&per_page=5`
      );
      const data = await res.json();

      if (!data.results || data.results.length === 0) return [];

      // Get papers from adjacent concepts
      const adjacentMethods = [];
      for (const concept of data.results.slice(0, 2)) {
        const methodRes = await fetch(
          `https://api.openalex.org/works?filter=concepts.id:"${concept.id}"&group_by=concepts&per_page=10`
        );
        const methodData = await methodRes.json();
        adjacentMethods.push(...(methodData.group_by || []).map(m => ({ method: m.key, count: m.count })));
      }

      return adjacentMethods.sort((a, b) => b.count - a.count).slice(0, 5);
    } catch {
      return [];
    }
  };

  const generateLatencyMap = async (q, gapList) => {
    if (gapList.length === 0) return [];

    try {
      const latencies = [];
      for (const gap of gapList) {
        // Estimate gap age by searching when this question was first asked
        const res = await fetch(
          `https://api.openalex.org/works?filter=title.search:"${encodeURIComponent(gap.research_question.substring(0, 50))}"&sort=publication_date&per_page=5`
        );
        const data = await res.json();

        if (data.results && data.results.length > 0) {
          const firstMention = new Date(data.results[data.results.length - 1]?.publication_date || new Date()).getFullYear();
          const ageYears = new Date().getFullYear() - firstMention;
          latencies.push({
            title: gap.title,
            question: gap.research_question,
            ageYears: Math.max(0, ageYears),
            novelty: gap.novelty_score
          });
        }
      }

      return latencies.sort((a, b) => b.ageYears - a.ageYears);
    } catch {
      return gapList.map((g, i) => ({ title: g.title, question: g.research_question, ageYears: 5 + i, novelty: g.novelty_score }));
    }
  };

  const deduplicateByTitle = (papers) => {
    const seen = new Set();
    return papers.filter(p => {
      if (seen.has(p.title)) return false;
      seen.add(p.title);
      return true;
    });
  };

  const filteredAndSortedPapers = useMemo(() => {
    let filtered = papers.filter(p =>
      p.year >= yearFilter[0] &&
      p.year <= yearFilter[1] &&
      (p.citationCount || 0) >= citationFilter &&
      (!showSavedOnly || savedPapers.has(p.paperId))
    );

    return filtered.sort((a, b) => {
      if (sortBy === 'citations') return (b.citationCount || 0) - (a.citationCount || 0);
      if (sortBy === 'year') return b.year - a.year;
      return 0;
    });
  }, [papers, yearFilter, citationFilter, sortBy, showSavedOnly, savedPapers]);

  const runPipeline = async () => {
    try {
      setError('');
      setStatus('extracting');
      const terms = await extractTerms(question);

      setStatus('pulling');
      const [trendData, ...paperResults] = await Promise.all([
        getTrends(question),
        ...terms.map(searchPapers)
      ]);
      setTrends(trendData);

      setStatus('searching');
      const scholarResults = await getGoogleScholarLinks(question);

      setStatus('merging');
      const allPapers = deduplicateByTitle([...paperResults.flat()]);
      const mergedPapers = mergePapersWithLinks(allPapers, scholarResults).slice(0, 20);
      setPapers(mergedPapers);

      setStatus('analyzing');
      const [summary, gapData] = await Promise.all([
        generateAISummary(question, mergedPapers),
        analyzeGaps(question, mergedPapers)
      ]);
      setAiSummary(summary);
      setGaps(gapData.gaps || []);
      setBigAssumption(gapData.biggest_assumption || '');

      // Calculate advanced metrics
      const score = calculateBlindSpotScore(mergedPapers, gapData.gaps || []);
      setBlindSpotScore(score);

      const methods = await findCrossFieldMethods(question);
      setCrossFieldMethods(methods);

      const latency = await generateLatencyMap(question, gapData.gaps || []);
      setLatencyMap(latency);

      // Find collaborators actively working on gaps
      const collabs = await findCollaborators(gapData.gaps || [], question);
      setCollaborators(collabs);

      setStatus('done');
    } catch (err) {
      console.error('Pipeline error:', err);
      setError(err.message || 'Error running analysis');
      setStatus('error');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (question.trim()) {
      // Add to search history
      setSearchHistory(prev => [question, ...prev.filter(q => q !== question)].slice(0, 10));
      runPipeline();
    }
  };

  const handleExportCSV = () => {
    const csv = [
      ['Title', 'Year', 'Citations', 'Authors', 'Link'].join(','),
      ...filteredAndSortedPapers.map(p =>
        [
          `"${p.title}"`,
          p.year,
          p.citationCount || 0,
          `"${(p.authors || []).slice(0, 3).map(a => a.name).join('; ')}"`,
          p.scholarLink
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="py-6 mb-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">📚 Research Navigator</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Find gaps, build proposals, find collaborators</p>
          </div>

          {/* Search */}
          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Search research topic..."
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-lg"
                  disabled={status !== 'idle' && status !== 'done' && status !== 'error'}
                  list="searchHistory"
                />
                <datalist id="searchHistory">
                  {searchHistory.map((q, i) => (
                    <option key={i} value={q} />
                  ))}
                </datalist>
              </div>
              <button
                type="submit"
                disabled={!question.trim() || (status !== 'idle' && status !== 'done' && status !== 'error')}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition"
              >
                {status === 'done' ? '🔄 Search' : 'Search'}
              </button>
            </div>

            {/* Quick search history */}
            {searchHistory.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Recent:</span>
                {searchHistory.slice(0, 4).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuestion(q);
                      setTimeout(() => document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true })), 0);
                    }}
                    className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                  >
                    {q.substring(0, 30)}...
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Tabs */}
          {status === 'done' && (
            <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('landscape')}
                className={`px-4 py-3 font-semibold border-b-2 transition ${
                  activeTab === 'landscape'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
                }`}
              >
                🗺️ Landscape
              </button>
              <button
                onClick={() => setActiveTab('proposal')}
                className={`px-4 py-3 font-semibold border-b-2 transition ${
                  activeTab === 'proposal'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
                }`}
              >
                📝 Proposal
              </button>
              <button
                onClick={() => setActiveTab('collaborate')}
                className={`px-4 py-3 font-semibold border-b-2 transition ${
                  activeTab === 'collaborate'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
                }`}
              >
                👥 Collaborate
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Status */}
        {status !== 'idle' && status !== 'error' && status !== 'done' && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded-lg animate-pulse">
            {status === 'extracting' && '🔍 Extracting search terms...'}
            {status === 'pulling' && '📈 Pulling research trends...'}
            {status === 'searching' && '🔗 Searching papers across sources...'}
            {status === 'merging' && '🧩 Merging results...'}
            {status === 'analyzing' && '🤖 AI analysis & finding collaborators...'}
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-lg">
            ⚠️ {error}
          </div>
        )}

        {status === 'done' && (
          <>
            {/* LANDSCAPE TAB */}
            {activeTab === 'landscape' && (
              <div className="space-y-8">
                {/* Trends */}
                {trends.length > 3 && (
                  <div className="p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Publication Trend</h2>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={trends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="year" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* AI Summary */}
                {aiSummary && (
                  <div className="p-6 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">🤖 AI Research Guide</h2>
                    <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
                  </div>
                )}

                {/* Advanced Metrics */}
                {(blindSpotScore !== null || crossFieldMethods.length > 0 || latencyMap.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Blind Spot Score */}
                    {blindSpotScore !== null && (
                      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-center">
                        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-red-100 to-orange-100 dark:from-red-900/30 dark:to-orange-900/30 mb-3">
                          <span className="text-3xl font-bold text-red-600 dark:text-red-400">{blindSpotScore}</span>
                        </div>
                        <h3 className="font-bold text-gray-900 dark:text-white mb-1">Blind Spot Score</h3>
                        <p className="text-xs text-gray-600 dark:text-gray-400">% Unexplored Territory</p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                          {blindSpotScore > 50 ? 'High unexplored territory' : blindSpotScore > 20 ? 'Moderate gaps' : 'Well-researched field'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 italic">({gaps.length} gaps vs {papers.length} papers)</p>
                      </div>
                    )}

                    {/* Cross-Field Methods */}
                    {crossFieldMethods.length > 0 && (
                      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h3 className="font-bold text-gray-900 dark:text-white mb-3">🔄 Cross-Field Methods</h3>
                        <div className="space-y-2 text-sm">
                          {crossFieldMethods.slice(0, 3).map((m, i) => (
                            <div key={i} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                              <p className="text-gray-700 dark:text-gray-300 font-medium line-clamp-1">{m.method}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">Used in {m.count} adjacent papers</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">Methods to apply from adjacent fields</p>
                      </div>
                    )}

                    {/* Latency Map */}
                    {latencyMap.length > 0 && (
                      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h3 className="font-bold text-gray-900 dark:text-white mb-3">⏱️ Gap Age</h3>
                        <div className="space-y-2 text-sm">
                          {latencyMap.slice(0, 3).map((g, i) => (
                            <div key={i} className={`p-2 rounded ${g.ageYears > 10 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-yellow-50 dark:bg-yellow-900/20'}`}>
                              <p className="text-gray-700 dark:text-gray-300 font-medium line-clamp-1 text-xs">{g.title}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{g.ageYears}+ years old</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">Red = long-standing gaps</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Gaps */}
                {gaps.length > 0 && (
                  <div className="border-t border-gray-300 dark:border-gray-700 pt-8">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">📊 Research Gaps</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {gaps.map((gap, idx) => (
                        <div key={idx} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <h3 className="font-bold text-gray-900 dark:text-white mb-2">{gap.title}</h3>
                          <p className="text-sm italic text-gray-700 dark:text-gray-300 mb-2">{gap.research_question}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{gap.why_missing}</p>
                          <div className="flex gap-2">
                            <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 text-xs rounded">Novelty: {gap.novelty_score}</span>
                            <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 text-xs rounded">{gap.difficulty}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trending Papers */}
                {papers.length > 0 && (
                  <div className="border-t border-gray-300 dark:border-gray-700 pt-8">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">⭐ Trending in This Field</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                      {[...papers].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0)).slice(0, 4).map((paper, idx) => (
                        <a
                          key={idx}
                          href={paper.scholarLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-4 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/10 dark:to-orange-900/10 rounded-lg border border-yellow-200 dark:border-yellow-700/30 hover:shadow-lg transition group"
                        >
                          <div className="flex items-start gap-2 mb-2">
                            <span className="text-2xl">📈</span>
                            <h3 className="font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition line-clamp-2">{paper.title}</h3>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                            {paper.authors?.slice(0, 1).map(a => a.name).join(', ')} • {paper.year}
                          </p>
                          <p className="text-xs text-orange-700 dark:text-orange-400 font-semibold">
                            🔥 {paper.citationCount} citations
                          </p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Papers Controls & List */}
                <div className="border-t border-gray-300 dark:border-gray-700 pt-8">
                  <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Year Range</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="1900"
                            max="2025"
                            value={yearFilter[0]}
                            onChange={(e) => setYearFilter([Math.max(1900, parseInt(e.target.value)), yearFilter[1]])}
                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                          />
                          <input
                            type="number"
                            min="1900"
                            max="2025"
                            value={yearFilter[1]}
                            onChange={(e) => setYearFilter([yearFilter[0], Math.min(2025, parseInt(e.target.value))])}
                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Min Citations: {citationFilter}</label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={citationFilter}
                          onChange={(e) => setCitationFilter(parseInt(e.target.value))}
                          className="w-full"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Sort By</label>
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        >
                          <option value="citations">Most Cited</option>
                          <option value="year">Newest</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter</label>
                        <button
                          onClick={() => setShowSavedOnly(!showSavedOnly)}
                          className={`w-full px-3 py-1 rounded font-medium text-sm transition ${
                            showSavedOnly
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {showSavedOnly ? '❤️ Saved' : '☆ All'}
                        </button>
                      </div>

                      <div className="flex items-end">
                        <button
                          onClick={handleExportCSV}
                          className="w-full px-4 py-1 bg-green-600 hover:bg-green-700 text-white rounded font-medium text-sm"
                        >
                          📥 Export CSV
                        </button>
                      </div>
                    </div>
                  </div>

                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                    📑 Papers ({filteredAndSortedPapers.length})
                  </h2>
                  <div className="space-y-3">
                    {filteredAndSortedPapers.map((paper, idx) => (
                      <div key={idx} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-lg transition group">
                        <div className="flex justify-between items-start gap-3 mb-3">
                          <div className="flex-1 min-w-0">
                            <a
                              href={paper.scholarLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-blue-600 dark:text-blue-400 hover:underline block"
                            >
                              {paper.title}
                            </a>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => toggleSavedPaper(paper.paperId)}
                              className={`px-2 py-1 rounded transition text-sm font-medium ${
                                savedPapers.has(paper.paperId)
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                              }`}
                            >
                              {savedPapers.has(paper.paperId) ? '❤️' : '☆'}
                            </button>
                            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm rounded-full whitespace-nowrap">
                              {paper.year}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3 mb-3 text-sm text-gray-600 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <span>📊</span>
                            <span>{paper.citationCount || 0} citations</span>
                          </span>
                          {paper.authors && paper.authors.length > 0 && (
                            <span className="flex items-center gap-1">
                              <span>👤</span>
                              <span className="line-clamp-1">{paper.authors.slice(0, 2).map(a => a.name).join(', ')}{paper.authors.length > 2 ? '...' : ''}</span>
                            </span>
                          )}
                          {paper.citationCount > 100 && (
                            <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded text-xs font-medium">
                              ⭐ Highly Cited
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-3">
                          {paper.scholarSnippet || paper.abstract?.substring(0, 200)}
                        </p>

                        <div>
                          <a
                            href={paper.scholarLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
                          >
                            📖 Read Paper →
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredAndSortedPapers.length === 0 && papers.length > 0 && (
                    <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                      No papers match your filters. Try adjusting the criteria.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PROPOSAL TAB */}
            {activeTab === 'proposal' && (
              <div className="space-y-8">
                {/* Grant Generator */}
                {gaps.length > 0 && (
                  <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-700">
                    <button
                      onClick={() => grantIntro ? setGrantIntro('') : generateGrantProposal(question, papers).then(setGrantIntro)}
                      className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold mb-4"
                    >
                      {grantIntro ? '✕ Hide Grant Intro' : '📝 Generate NSF Grant Intro'}
                    </button>
                    {grantIntro && (
                      <div className="p-4 bg-white dark:bg-gray-800 rounded text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                        {grantIntro}
                      </div>
                    )}
                  </div>
                )}

                {/* Big Assumption */}
                {bigAssumption && (
                  <div className="p-6 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 rounded-lg border-2 border-orange-300 dark:border-orange-700">
                    <p className="text-sm font-bold text-orange-600 dark:text-orange-400 uppercase mb-2">🎯 The Field's Biggest Untested Assumption</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white italic">"{bigAssumption}"</p>
                  </div>
                )}

                {/* Identified Gaps for Proposal */}
                {gaps.length > 0 && (
                  <div className="border-t border-gray-300 dark:border-gray-700 pt-8">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">📋 Research Gaps (from Landscape)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {gaps.map((gap, idx) => (
                        <div key={idx} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <h3 className="font-bold text-gray-900 dark:text-white mb-2">{gap.title}</h3>
                          <p className="text-sm italic text-gray-700 dark:text-gray-300 mb-2">{gap.research_question}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{gap.why_missing}</p>
                          <div className="flex gap-2">
                            <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 text-xs rounded">Novelty: {gap.novelty_score}</span>
                            <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 text-xs rounded">{gap.difficulty}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* COLLABORATE TAB */}
            {activeTab === 'collaborate' && (
              <div className="space-y-8">
                <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">👥 Find Collaborators</h2>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Researchers actively working on the identified gaps in your field. These researchers may be seeking collaborators.</p>
                </div>

                {gaps.length > 0 ? (
                  <div className="space-y-6">
                    {gaps.map((gap, gapIdx) => (
                      <div key={gapIdx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                        <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-200 dark:border-gray-700">
                          <h3 className="font-bold text-gray-900 dark:text-white">{gap.title}</h3>
                          <p className="text-sm text-gray-700 dark:text-gray-300 italic mt-1">{gap.research_question}</p>
                        </div>

                        <div className="p-4">
                          {collaborators[gap.title] && collaborators[gap.title].length > 0 ? (
                            <div className="space-y-3">
                              {collaborators[gap.title].map((collab, idx) => (
                                <div key={idx} className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 hover:shadow transition">
                                  <p className="font-semibold text-gray-900 dark:text-white">👤 {collab.name}</p>
                                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                    Recent publication {collab.year} • Working on related research
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                              No recent collaborators found for this gap. Try searching for related research on Google Scholar or ResearchGate.
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    <p>Run a search first to identify gaps and find collaborators.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
