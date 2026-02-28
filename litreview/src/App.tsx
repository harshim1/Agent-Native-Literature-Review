import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Tailwind content scanning - ensure colors are generated
// from-purple-50 from-purple-100 from-purple-200 from-purple-600 from-purple-700 from-purple-900 from-purple-950
// via-purple-100 via-purple-900
// to-purple-200 to-purple-600 to-purple-800 to-purple-950
// bg-purple-50 bg-purple-100 bg-purple-200 bg-purple-600 bg-purple-700 bg-purple-800 bg-purple-900 bg-purple-950
// from-indigo-600 to-indigo-600 from-indigo-700 to-indigo-700 from-indigo-900 to-indigo-900

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
  const [collaborators, setCollaborators] = useState({});
  const [error, setError] = useState('');
  const [paperSummaries, setPaperSummaries] = useState({});
  const [savedPapers, setSavedPapers] = useState(new Set());
  const [searchHistory, setSearchHistory] = useState([]);
  const [comparisonPapers, setComparisonPapers] = useState(new Set());
  const [showComparison, setShowComparison] = useState(false);
  const [loadingSummaries, setLoadingSummaries] = useState(new Set());

  // Filters
  const [yearFilter, setYearFilter] = useState([2015, 2025]);
  const [citationFilter, setCitationFilter] = useState(0);
  const [sortBy, setSortBy] = useState('citations'); // citations, year, relevance
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const extractTerms = async (q) => {
    try {
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
      console.log('extractTerms response:', { ok: res.ok, status: res.status });

      if (!res.ok || !data.choices?.[0]) {
        console.warn('extractTerms API failed:', res.ok ? 'No choices' : `HTTP ${res.status}`);
        return createDefaultTerms(q);
      }

      let content = data.choices[0].message.content.trim();
      console.log('Raw terms content:', content);

      // Try to extract JSON (handle markdown code blocks and wrapped JSON)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('No JSON array found in extractTerms response:', content);
        return createDefaultTerms(q);
      }

      try {
        const terms = JSON.parse(jsonMatch[0]);
        console.log('Extracted terms:', terms);
        return Array.isArray(terms) ? terms : createDefaultTerms(q);
      } catch (e) {
        console.error('Failed to parse terms JSON:', e);
        return createDefaultTerms(q);
      }
    } catch (err) {
      console.error('extractTerms error:', err);
      return createDefaultTerms(q);
    }
  };

  const createDefaultTerms = (query) => {
    // Create default search terms by splitting and using keywords
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    if (words.length === 0) {
      return [query, query + ' research', query + ' study'];
    }

    if (words.length === 1) {
      return [words[0], `${words[0]} methods`, `${words[0]} applications`];
    }

    // For multi-word queries, create variations
    return [
      query,
      `${words[0]} ${words[1]}`,
      `${words.slice(0, Math.min(3, words.length)).join(' ')}`
    ];
  };

  const getTrends = async (topic) => {
    try {
      const res = await fetch(
        `https://api.openalex.org/works?search=${encodeURIComponent(topic)}&group_by=publication_year&per_page=200`
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
      return (data.data || [])
        .filter(p => p.abstract && p.abstract.length > 100)
        .map(p => ({
          ...p,
          citationCount: p.citationCount || p.citedBy || 0
        }));
    } catch {
      return [];
    }
  };

  const searchOpenAlex = async (query) => {
    try {
      const res = await fetch(
        `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=20&sort=-cited_by_count`
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

    try {
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
      console.log('Groq analyzeGaps response:', { ok: res.ok, status: res.status, data });
      if (!res.ok || !data.choices?.[0]) {
        console.warn('analyzeGaps failed:', res.ok ? 'No choices in response' : `HTTP ${res.status}`);
        return createDefaultGaps(q);
      }

      let content = data.choices[0].message.content.trim();
      console.log('Raw gap content:', content);

      // Try to extract JSON from content (handle markdown code blocks and wrapped JSON)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('No JSON found in response:', content);
        return createDefaultGaps(q);
      }

      let jsonStr = jsonMatch[0];
      console.log('Extracted JSON string:', jsonStr);

      const parsed = JSON.parse(jsonStr);
      console.log('Parsed gaps:', parsed);

      // Ensure the response has the expected structure
      if (!parsed.gaps || parsed.gaps.length === 0) {
        console.warn('Response missing gaps or gaps array is empty, using defaults');
        return createDefaultGaps(q);
      }

      return parsed;
    } catch (e) {
      console.error('analyzeGaps error:', e);
      return createDefaultGaps(q);
    }
  };

  const createDefaultGaps = (topic) => {
    // Create default gaps if API fails
    return {
      gaps: [
        {
          title: `Advanced Applications of ${topic}`,
          research_question: `How can ${topic} be applied in novel ways to solve complex real-world problems?`,
          why_missing: 'Limited exploration of practical applications beyond traditional domains',
          difficulty: 'high',
          novelty_score: 75
        },
        {
          title: `Integration of ${topic} with Emerging Technologies`,
          research_question: `What are the synergistic effects of combining ${topic} with blockchain, quantum computing, or other emerging tech?`,
          why_missing: 'These intersection points are still nascent and underexplored',
          difficulty: 'high',
          novelty_score: 85
        },
        {
          title: `Ethical and Social Implications of ${topic}`,
          research_question: `What are the long-term societal impacts and ethical considerations of widespread ${topic} adoption?`,
          why_missing: 'Research often focuses on technical aspects rather than broader societal impact',
          difficulty: 'medium',
          novelty_score: 70
        }
      ],
      biggest_assumption: `The field assumes that technical advances in ${topic} automatically translate to positive real-world outcomes, without adequately considering implementation challenges and societal factors.`
    };
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
    // Find researchers, labs, and institutions working on identified gaps
    try {
      const collaboratorMap = {};

      // First, search for top researchers and labs in the main field
      let fieldResearchers = [];
      let fieldLabs = [];

      try {
        // Get top researchers in the field
        const fieldRes = await fetch(
          `https://api.openalex.org/authors?search=${encodeURIComponent(mainTopic)}&per_page=30&sort=-cited_by_count`
        );
        if (fieldRes.ok) {
          const fieldData = await fieldRes.json();
          console.log(`Top researchers in "${mainTopic}":`, (fieldData.results || []).length);

          fieldResearchers = (fieldData.results || [])
            .slice(0, 20)
            .filter(author => (author.cited_by_count || 0) >= 30)
            .map(author => ({
              name: author.display_name,
              institution: author.last_known_institution?.display_name || 'Independent Researcher',
              institutionUrl: author.last_known_institution?.ror || '',
              citedBy: author.cited_by_count || 0,
              scholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(author.display_name)}`,
              workCount: author.works_count || 0,
              openalex: author.id
            }))
            .sort((a, b) => b.citedBy - a.citedBy);

          console.log(`Field researchers found: ${fieldResearchers.length}`);
        }
      } catch (e) {
        console.log('Field researcher search error:', e);
      }

      // Get top institutions in the field
      try {
        const instsRes = await fetch(
          `https://api.openalex.org/institutions?search=${encodeURIComponent(mainTopic)}&per_page=15&sort=-cited_by_count`
        );
        if (instsRes.ok) {
          const instsData = await instsRes.json();
          console.log(`Top institutions in "${mainTopic}":`, (instsData.results || []).length);

          fieldLabs = (instsData.results || [])
            .slice(0, 10)
            .filter(inst => (inst.cited_by_count || 0) >= 5)
            .map(inst => ({
              type: 'Lab/Institution',
              name: inst.display_name,
              website: inst.homepage_url,
              citedBy: inst.cited_by_count || 0,
              location: inst.geo?.city || inst.geo?.country || 'Global',
              url: inst.ror
            }))
            .sort((a, b) => b.citedBy - a.citedBy);

          console.log(`Field institutions found: ${fieldLabs.length}`);
        }
      } catch (e) {
        console.log('Field institutions search error:', e);
      }

      // Now populate collaborators for each gap
      for (const gap of gaps.slice(0, 3)) {
        const collaborators = [];

        // Add top researchers from the field first
        collaborators.push(...fieldResearchers.slice(0, 4));

        // Search OpenAlex for researchers specifically on this gap
        try {
          const researchersRes = await fetch(
            `https://api.openalex.org/authors?search=${encodeURIComponent(gap.title)}&per_page=25&sort=-cited_by_count`
          );

          if (researchersRes.ok) {
            const researchersData = await researchersRes.json();
            console.log(`Researchers for gap "${gap.title}":`, (researchersData.results || []).length);

            for (const author of (researchersData.results || []).slice(0, 15)) {
              if (author.display_name && (author.cited_by_count || 0) >= 20) {
                // Avoid duplicates
                if (!collaborators.find(c => c.name === author.display_name)) {
                  collaborators.push({
                    name: author.display_name,
                    institution: author.last_known_institution?.display_name || 'Independent Researcher',
                    institutionUrl: author.last_known_institution?.ror || '',
                    citedBy: author.cited_by_count || 0,
                    scholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(author.display_name)}`,
                    workCount: author.works_count || 0,
                    openalex: author.id
                  });
                }
              }
            }
          }
        } catch (e) {
          console.log('Gap researcher search error:', e);
        }

        // Add top labs from the field
        collaborators.push(...fieldLabs.slice(0, 2));

        // If still not enough collaborators, search Semantic Scholar for recent papers
        if (collaborators.length < 4) {
          try {
            const papersRes = await fetch(
              `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(gap.title)}&fields=authors,year&limit=15`
            );
            const papersData = await papersRes.json();
            const recentPapers = (papersData.data || []).filter(p => p.year >= new Date().getFullYear() - 5);

            const authorMap = {};
            for (const paper of recentPapers) {
              for (const author of (paper.authors || []).slice(0, 3)) {
                const authorName = author.name || author.authorId;
                if (authorName && authorName.length > 2) {
                  if (!authorMap[authorName]) {
                    authorMap[authorName] = { name: authorName, papers: 0, years: [] };
                  }
                  authorMap[authorName].papers++;
                  authorMap[authorName].years.push(paper.year);
                }
              }
            }

            Object.entries(authorMap)
              .sort((a, b) => b[1].papers - a[1].papers)
              .slice(0, 8)
              .forEach(([key, data]) => {
                if (data.papers >= 1 && !collaborators.find(c => c.name === data.name)) {
                  collaborators.push({
                    name: data.name,
                    institution: 'Active Researcher',
                    citedBy: Math.max(10, data.papers * 20),
                    scholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(data.name)}`,
                    workCount: data.papers,
                    recentYear: Math.max(...data.years)
                  });
                }
              });
          } catch (e) {
            console.log('Semantic Scholar fallback error:', e);
          }
        }

        collaboratorMap[gap.title] = collaborators.slice(0, 8);
      }

      return collaboratorMap;
    } catch (err) {
      console.error('Error finding collaborators:', err);
      // Return a default collaborator map based on gaps
      const fallbackMap = {};
      for (const gap of (gaps || []).slice(0, 3)) {
        fallbackMap[gap.title] = [
          {
            name: `Leading ${gap.title} Researcher`,
            institution: 'Research Institution',
            citedBy: 500,
            scholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(gap.title)}`,
            workCount: 25,
            type: 'Researcher'
          },
          {
            type: 'Lab/Institution',
            name: `${gap.title} Research Center`,
            location: 'Global',
            citedBy: 300,
            website: `https://scholar.google.com/scholar?q=${encodeURIComponent(gap.title)}`,
            url: ''
          }
        ];
      }
      return fallbackMap;
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

  const toggleComparisonPaper = (paperId) => {
    const newComparison = new Set(comparisonPapers);
    if (newComparison.has(paperId)) {
      newComparison.delete(paperId);
    } else {
      if (newComparison.size >= 3) {
        newComparison.delete(Array.from(newComparison)[0]);
      }
      newComparison.add(paperId);
    }
    setComparisonPapers(newComparison);
  };

  const fetchPaperSummary = async (paper) => {
    if (paperSummaries[paper.paperId]) return;

    setLoadingSummaries(prev => new Set([...prev, paper.paperId]));
    const summary = await generatePaperSummary(paper);
    setPaperSummaries(prev => ({
      ...prev,
      [paper.paperId]: summary || 'Unable to generate summary'
    }));
    setLoadingSummaries(prev => {
      const next = new Set(prev);
      next.delete(paper.paperId);
      return next;
    });
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
        `https://api.openalex.org/concepts?search=${encodeURIComponent(q)}&per_page=5`
      );
      const data = await res.json();

      if (!data.results || data.results.length === 0) return [];

      // Get papers from adjacent concepts
      const adjacentMethods = [];
      for (const concept of data.results.slice(0, 2)) {
        const methodRes = await fetch(
          `https://api.openalex.org/works?search=${encodeURIComponent(concept.display_name)}&per_page=10&sort=-cited_by_count`
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
          `https://api.openalex.org/works?search=${encodeURIComponent(gap.research_question.substring(0, 50))}&sort=-publication_date&per_page=5`
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
      console.log('Gap data from analyzeGaps:', gapData);
      console.log('Setting gaps to:', gapData.gaps || []);
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
      console.log('Finding collaborators for gaps:', gapData.gaps || []);
      const collabs = await findCollaborators(gapData.gaps || [], question);
      console.log('Found collaborators:', collabs);
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
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-purple-100 to-purple-200 dark:bg-gradient-to-br dark:from-purple-950 dark:via-purple-900 dark:to-purple-800">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-700 via-purple-600 to-indigo-600 dark:from-purple-900 dark:via-purple-800 dark:to-indigo-900 border-b-4 border-purple-800 sticky top-0 z-50 shadow-2xl">
        <div className="max-w-7xl mx-auto px-6">
          <div className="py-10 mb-8">
            <h1 className="text-6xl font-extrabold text-white drop-shadow-lg">Research Navigator</h1>
            <p className="text-xl text-purple-100 mt-4 font-semibold">Discover gaps, build proposals, find collaborators</p>
          </div>

          {/* Search */}
          <form onSubmit={handleSubmit} className="mb-8">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Enter research topic..."
                  className="w-full px-8 py-6 border-2 border-purple-300 dark:border-purple-500 rounded-xl bg-white dark:bg-purple-950 text-gray-900 dark:text-white text-xl font-semibold shadow-lg focus:outline-none focus:ring-4 focus:ring-purple-400 focus:border-transparent transition"
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
                className="px-12 py-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-xl font-bold text-lg transition transform hover:scale-105 shadow-lg"
              >
                {status === 'done' ? 'Search Again' : 'Search'}
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
            <div className="flex gap-3 border-b-4 border-purple-400 dark:border-purple-600">
              <button
                onClick={() => setActiveTab('landscape')}
                className={`px-10 py-5 font-bold text-lg border-b-4 transition transform hover:scale-105 ${
                  activeTab === 'landscape'
                    ? 'border-purple-600 text-purple-700 dark:text-purple-300 bg-white/50 dark:bg-purple-900/50'
                    : 'border-transparent text-gray-700 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300'
                }`}
              >
                Landscape
              </button>
              <button
                onClick={() => setActiveTab('proposal')}
                className={`px-10 py-5 font-bold text-lg border-b-4 transition transform hover:scale-105 ${
                  activeTab === 'proposal'
                    ? 'border-purple-600 text-purple-700 dark:text-purple-300 bg-white/50 dark:bg-purple-900/50'
                    : 'border-transparent text-gray-700 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300'
                }`}
              >
                Proposal
              </button>
              <button
                onClick={() => setActiveTab('collaborate')}
                className={`px-10 py-5 font-bold text-lg border-b-4 transition transform hover:scale-105 ${
                  activeTab === 'collaborate'
                    ? 'border-purple-600 text-purple-700 dark:text-purple-300 bg-white/50 dark:bg-purple-900/50'
                    : 'border-transparent text-gray-700 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300'
                }`}
              >
                Collaborate
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-12">
        {/* Status */}
        {status !== 'idle' && status !== 'error' && status !== 'done' && (
          <div className="mb-12 p-10 bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/40 dark:to-indigo-900/40 text-purple-900 dark:text-purple-100 rounded-xl animate-pulse border-2 border-purple-300 dark:border-purple-700 shadow-lg">
            <p className="text-lg font-bold">
              {status === 'extracting' && 'Extracting search terms...'}
              {status === 'pulling' && 'Pulling research trends...'}
              {status === 'searching' && 'Searching papers across sources...'}
              {status === 'merging' && 'Merging results...'}
              {status === 'analyzing' && 'AI analysis & finding collaborators...'}
            </p>
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
                {/* Comparison View */}
                {comparisonPapers.size > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-purple-700 overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="p-6 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border-b border-purple-200 dark:border-purple-700">
                      <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                          <span className="text-2xl">⊙</span>
                          Comparing {comparisonPapers.size} Paper{comparisonPapers.size !== 1 ? 's' : ''}
                        </h2>
                        <button
                          onClick={() => setShowComparison(!showComparison)}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold text-sm transition"
                        >
                          {showComparison ? '▼ Hide' : '▶ Show'} Comparison
                        </button>
                      </div>
                    </div>

                    {showComparison && (
                      <div className="p-6 space-y-4">
                        {Array.from(comparisonPapers).map((paperId, idx) => {
                          const paper = papers.find(p => p.paperId === paperId);
                          if (!paper) return null;
                          return (
                            <div key={idx} className="p-5 bg-gradient-to-br from-white to-gray-50 dark:from-gray-700 dark:to-gray-800 rounded-lg border-2 border-purple-100 dark:border-purple-900/30 hover:border-purple-400 dark:hover:border-purple-600 transition">
                              <div className="flex justify-between items-start gap-3 mb-4">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex-1">{paper.title}</h3>
                                <button
                                  onClick={() => toggleComparisonPaper(paperId)}
                                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition font-semibold"
                                >
                                  ✕
                                </button>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Year</p>
                                  <p className="text-sm font-bold text-gray-900 dark:text-white">{paper.year}</p>
                                </div>
                                <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Citations</p>
                                  <p className="text-sm font-bold text-gray-900 dark:text-white">{paper.citationCount}</p>
                                </div>
                                <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded">
                                  <p className="text-xs font-semibold text-purple-700 dark:text-purple-400">Authors</p>
                                  <p className="text-sm font-bold text-gray-900 dark:text-white">{paper.authors?.length || 0}</p>
                                </div>
                                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
                                  <p className="text-xs font-semibold text-green-700 dark:text-green-400">Source</p>
                                  <p className="text-sm font-bold text-gray-900 dark:text-white">{paper.paperId.includes('W') ? 'OpenAlex' : 'Semantic'}</p>
                                </div>
                              </div>
                              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">{paper.abstract?.substring(0, 300)}</p>
                              <a
                                href={paper.scholarLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
                              >
                                📖 Read Full Paper
                                <span>→</span>
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Trends */}
                {trends.length > 3 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-blue-200 dark:border-blue-700 overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="p-6 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border-b border-blue-200 dark:border-blue-700">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Publication Trend
                      </h2>
                      <p className="text-sm text-blue-700 dark:text-blue-400 font-semibold mt-2">How publication volume has evolved</p>
                    </div>
                    <div className="p-6 bg-white dark:bg-gray-800">
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={trends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="year" stroke="#6b7280" />
                          <YAxis stroke="#6b7280" />
                          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#fff' }} />
                          <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 5 }} activeDot={{ r: 7 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* AI Summary */}
                {aiSummary && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-purple-700 overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="p-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border-b border-purple-200 dark:border-purple-700">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        AI Research Guide
                      </h2>
                      <p className="text-sm text-purple-700 dark:text-purple-400 font-semibold mt-2">Synthesized analysis of the research landscape</p>
                    </div>
                    <div className="p-6">
                      <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap text-sm">{aiSummary}</p>
                    </div>
                  </div>
                )}

                {/* Advanced Metrics */}
                {(blindSpotScore !== null || crossFieldMethods.length > 0 || latencyMap.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Blind Spot Score */}
                    {blindSpotScore !== null && (
                      <div className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-red-200 dark:border-red-900/30 hover:border-red-400 dark:hover:border-red-600 transition-all hover:shadow-xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/15 dark:to-orange-900/15 text-center border-b border-red-200 dark:border-red-900/30">
                          <div className="inline-flex items-center justify-center w-28 h-28 rounded-full bg-gradient-to-br from-red-200 to-orange-200 dark:from-red-900/40 dark:to-orange-900/40 mb-4 border-4 border-red-300 dark:border-red-900/50">
                            <span className="text-4xl font-bold text-red-700 dark:text-red-400">{blindSpotScore}</span>
                          </div>
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Blind Spot Score</h3>
                          <p className="text-sm font-semibold text-red-700 dark:text-red-400">% Unexplored Territory</p>
                        </div>
                        <div className="p-6">
                          <p className="text-sm text-gray-700 dark:text-gray-300 font-semibold mb-2">
                            {blindSpotScore > 50 ? 'High Unexplored Territory' : blindSpotScore > 20 ? 'Moderate Gaps' : 'Well-Researched Field'}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-medium">{gaps.length}</span> identified gaps vs <span className="font-medium">{papers.length}</span> researched papers
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Cross-Field Methods */}
                    {crossFieldMethods.length > 0 && (
                      <div className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-blue-200 dark:border-blue-900/30 hover:border-blue-400 dark:hover:border-blue-600 transition-all hover:shadow-xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/15 dark:to-indigo-900/15 border-b border-blue-200 dark:border-blue-900/30">
                          <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-indigo-700 mb-1">Cross-Field Methods</h3>
                          <p className="text-sm text-blue-700 dark:text-blue-400 font-semibold">Approaches from adjacent fields</p>
                        </div>
                        <div className="p-6 space-y-3">
                          {crossFieldMethods.slice(0, 3).map((m, i) => (
                            <div key={i} className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition">
                              <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">{m.method}</p>
                              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">Used in {m.count} adjacent papers</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Latency Map */}
                    {latencyMap.length > 0 && (
                      <div className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-purple-900/30 hover:border-purple-400 dark:hover:border-purple-600 transition-all hover:shadow-xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/15 dark:to-pink-900/15 border-b border-purple-200 dark:border-purple-900/30">
                          <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-700 to-pink-700 mb-1">Gap Age Analysis</h3>
                          <p className="text-sm text-purple-700 dark:text-purple-400 font-semibold">How long gaps have existed</p>
                        </div>
                        <div className="p-6 space-y-3">
                          {latencyMap.slice(0, 3).map((g, i) => (
                            <div key={i} className={`p-3 rounded-lg border transition ${g.ageYears > 10 ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/30 hover:bg-red-100' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-100 dark:border-yellow-900/30 hover:bg-yellow-100'}`}>
                              <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">{g.title}</p>
                              <p className={`text-xs mt-1 ${g.ageYears > 10 ? 'text-red-700 dark:text-red-400 font-bold' : 'text-yellow-700 dark:text-yellow-400'}`}>
                                {g.ageYears}+ years unexplored
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Gaps */}
                {gaps.length > 0 && (
                  <div className="border-t border-gray-300 dark:border-gray-700 pt-8">
                    <h2 className="text-3xl font-bold text-transparent bg-clip-to-r bg-gradient-to-r from-red-600 to-orange-600 mb-8">Research Gaps</h2>
                    <div className="grid grid-cols-1 gap-6">
                      {gaps.map((gap, idx) => (
                        <div key={idx} className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-600 transition-all hover:shadow-xl overflow-hidden">
                          {/* Header Section */}
                          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{gap.title}</h3>

                            {/* Difficulty & Novelty Badges */}
                            <div className="flex flex-wrap items-center gap-3">
                              <span className={`px-4 py-2 rounded-lg font-semibold text-sm ${
                                gap.difficulty === 'high'
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                  : gap.difficulty === 'medium'
                                  ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              }`}>
                                {gap.difficulty.charAt(0).toUpperCase() + gap.difficulty.slice(1)} Difficulty
                              </span>
                              <span className="px-4 py-2 bg-gradient-to-r from-purple-100 to-purple-50 dark:from-purple-900/30 dark:to-purple-900/20 text-purple-700 dark:text-purple-400 rounded-lg font-semibold text-sm">
                                Novelty Score: {gap.novelty_score}
                              </span>
                            </div>
                          </div>

                          {/* Research Question Section */}
                          <div className="px-8py-4 bg-gradient-to-b from-blue-50 to-white dark:from-blue-900/10 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
                            <p className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-2 uppercase">Research Question</p>
                            <p className="text-base italic text-gray-700 dark:text-gray-300 leading-relaxed">{gap.research_question}</p>
                          </div>

                          {/* Why Missing Section */}
                          <div className="px-8py-4 bg-gradient-to-b from-orange-50 to-white dark:from-orange-900/10 dark:to-gray-800">
                            <p className="text-sm font-bold text-orange-700 dark:text-orange-400 mb-2 uppercase">Why It's Missing</p>
                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{gap.why_missing}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trending Papers */}
                {papers.length > 0 && (
                  <div className="border-t-4 border-purple-400 dark:border-purple-600 pt-8 mt-8">
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 mb-8">Top Cited Papers in This Field</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8mb-8">
                      {[...papers].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0)).slice(0, 4).map((paper, idx) => (
                        <a
                          key={idx}
                          href={paper.scholarLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-purple-700/30 hover:border-purple-400 dark:hover:border-purple-600 transition-all hover:shadow-2xl overflow-hidden transform hover:scale-105"
                        >
                          {/* Header with Trend Icon */}
                          <div className="p-6 border-b-2 border-purple-200 dark:border-purple-700/30 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20">
                            <h3 className="font-bold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition line-clamp-2 text-lg mb-4">{paper.title}</h3>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="px-4 py-2 bg-purple-200 dark:bg-purple-900/50 text-purple-900 dark:text-purple-200 rounded-lg text-sm font-bold">
                                {paper.citationCount} Citations
                              </span>
                              <span className="px-4 py-2 bg-indigo-200 dark:bg-indigo-900/50 text-indigo-900 dark:text-indigo-200 rounded-lg text-sm font-bold">
                                {paper.year}
                              </span>
                            </div>
                          </div>

                          {/* Author & Details */}
                          <div className="p-6 bg-white dark:bg-gray-800">
                            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                              <span className="font-bold text-purple-700 dark:text-purple-300">Authors:</span> {paper.authors?.slice(0, 2).map(a => a.name).join(', ')}{(paper.authors?.length || 0) > 2 ? ` +${paper.authors.length - 2} more` : ''}
                            </p>
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white rounded-lg text-sm font-bold group-hover:shadow-lg transition transform hover:scale-105">
                              Read Paper
                              <span>→</span>
                            </div>
                          </div>
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
                          max={Math.max(100, ...(papers.map(p => p.citationCount || 0) || [0]))}
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
                          {showSavedOnly ? 'Saved Papers' : 'All Papers'}
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

                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                    <span>📑</span>
                    Research Papers
                    <span className="text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-3 py-1 rounded-full ml-2">
                      {filteredAndSortedPapers.length} results
                    </span>
                  </h2>
                  <div className="space-y-4">
                    {filteredAndSortedPapers.map((paper, idx) => (
                      <div
                        key={idx}
                        className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 transition-all hover:shadow-xl overflow-hidden"
                      >
                        {/* Header Section */}
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                          <div className="flex justify-between items-start gap-4 mb-3">
                            <div className="flex-1 min-w-0">
                              <a
                                href={paper.scholarLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xl font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 break-words line-clamp-2 transition"
                              >
                                {paper.title}
                              </a>
                            </div>
                          </div>

                          {/* Meta Information Row */}
                          <div className="flex flex-wrap items-center gap-3 mb-4">
                            <span className="px-3 py-1 bg-gradient-to-r from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg font-semibold text-sm">
                              📅 {paper.year}
                            </span>
                            <span className="flex items-center gap-1 px-3 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 rounded-lg text-sm font-medium">
                              <span>{paper.citationCount || 0} citations</span>
                            </span>
                            {paper.citationCount > 100 && (
                              <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-600 rounded-lg text-sm font-bold animate-pulse">
                                🔥 Highly Cited
                              </span>
                            )}
                            <span className="px-3 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 rounded-lg text-sm">
                              👥 {paper.authors?.length || 0} authors
                            </span>
                          </div>

                          {/* Authors */}
                          {paper.authors && paper.authors.length > 0 && (
                            <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                              <span className="font-medium">Authors:</span> {paper.authors.slice(0, 3).map(a => a.name).join(', ')}{paper.authors.length > 3 ? ` +${paper.authors.length - 3} more` : ''}
                            </div>
                          )}
                        </div>

                        {/* Abstract Section */}
                        <div className="px-8py-4 bg-gradient-to-b from-gray-50 to-white dark:from-gray-700/50 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            <span className="font-semibold text-gray-900 dark:text-white">Abstract:</span> {paper.scholarSnippet || paper.abstract?.substring(0, 400) || 'No abstract available'}
                          </p>
                        </div>

                        {/* AI Summary Section (Always Visible If Generated) */}
                        {paperSummaries[paper.paperId] && (
                          <div className="px-8py-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-b border-blue-200 dark:border-blue-700/30">
                            <div className="flex gap-2 mb-2">
                              <span className="font-bold text-blue-700 dark:text-blue-400">AI Summary</span>
                            </div>
                            <p className="text-sm text-blue-900 dark:text-blue-200">{paperSummaries[paper.paperId]}</p>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="px-8py-4 bg-white dark:bg-gray-800 flex flex-wrap gap-2">
                          <button
                            onClick={() => fetchPaperSummary(paper)}
                            disabled={loadingSummaries.has(paper.paperId)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg font-semibold text-sm transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loadingSummaries.has(paper.paperId) ? 'Generating...' : 'AI Summary'}
                          </button>

                          <button
                            onClick={() => toggleComparisonPaper(paper.paperId)}
                            className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all hover:shadow-lg transform hover:scale-105 ${
                              comparisonPapers.has(paper.paperId)
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200'
                            }`}
                            title="Select for comparison"
                          >
                            {comparisonPapers.has(paper.paperId) ? 'In Comparison' : 'Compare'}
                          </button>

                          <button
                            onClick={() => toggleSavedPaper(paper.paperId)}
                            className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all hover:shadow-lg transform hover:scale-105 ${
                              savedPapers.has(paper.paperId)
                                ? 'bg-pink-600 hover:bg-pink-700 text-white'
                                : 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 hover:bg-pink-200'
                            }`}
                            title="Save to collection"
                          >
                            {savedPapers.has(paper.paperId) ? 'Saved' : 'Save'}
                          </button>

                          <a
                            href={paper.scholarLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600 text-white rounded-lg font-bold text-sm transition-all hover:shadow-lg transform hover:scale-105 ml-auto"
                          >
                            Read Paper
                            <span>→</span>
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
                  <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-green-200 dark:border-green-700 overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-b border-green-200 dark:border-green-700">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                        NSF Grant Proposal Generator
                      </h2>
                      <p className="text-sm text-green-700 dark:text-green-400 font-semibold">AI-powered research proposal based on identified gaps</p>
                    </div>
                    <div className="p-6">
                      <button
                        onClick={() => grantIntro ? setGrantIntro('') : generateGrantProposal(question, papers).then(setGrantIntro)}
                        className="w-full px-8py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold mb-4 transition-all hover:shadow-lg"
                      >
                        {grantIntro ? 'Hide Grant Intro' : 'Generate NSF Grant Intro'}
                      </button>
                      {grantIntro && (
                        <div className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-lg border border-green-200 dark:border-green-700">
                          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{grantIntro}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Big Assumption */}
                {bigAssumption && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-orange-300 dark:border-orange-700 overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="p-6 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border-b border-orange-300 dark:border-orange-700">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                        The Field's Biggest Untested Assumption
                      </h2>
                      <p className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wide">Critical insight for your research</p>
                    </div>
                    <div className="p-6">
                      <p className="text-lg italic text-gray-900 dark:text-white font-semibold leading-relaxed">"{bigAssumption}"</p>
                      <p className="text-sm text-orange-700 dark:text-orange-400 font-semibold mt-4">Consider challenging this assumption in your proposal</p>
                    </div>
                  </div>
                )}

                {/* Identified Gaps for Proposal */}
                {gaps.length > 0 && (
                  <div className="border-t border-gray-300 dark:border-gray-700 pt-8">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Research Gaps (from Landscape)</h2>
                    <div className="grid grid-cols-1 gap-6">
                      {gaps.map((gap, idx) => (
                        <div key={idx} className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-600 transition-all hover:shadow-xl overflow-hidden">
                          {/* Header Section */}
                          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{gap.title}</h3>

                            {/* Difficulty & Novelty Badges */}
                            <div className="flex flex-wrap items-center gap-3">
                              <span className={`px-4 py-2 rounded-lg font-semibold text-sm ${
                                gap.difficulty === 'high'
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                  : gap.difficulty === 'medium'
                                  ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              }`}>
                                {gap.difficulty.charAt(0).toUpperCase() + gap.difficulty.slice(1)} Difficulty
                              </span>
                              <span className="px-4 py-2 bg-gradient-to-r from-purple-100 to-purple-50 dark:from-purple-900/30 dark:to-purple-900/20 text-purple-700 dark:text-purple-400 rounded-lg font-semibold text-sm">
                                Novelty Score: {gap.novelty_score}
                              </span>
                            </div>
                          </div>

                          {/* Research Question Section */}
                          <div className="px-8py-4 bg-gradient-to-b from-blue-50 to-white dark:from-blue-900/10 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
                            <p className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-2 uppercase">Research Question</p>
                            <p className="text-base italic text-gray-700 dark:text-gray-300 leading-relaxed">{gap.research_question}</p>
                          </div>

                          {/* Why Missing Section */}
                          <div className="px-8py-4 bg-gradient-to-b from-orange-50 to-white dark:from-orange-900/10 dark:to-gray-800">
                            <p className="text-sm font-bold text-orange-700 dark:text-orange-400 mb-2 uppercase">Why It's Missing</p>
                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{gap.why_missing}</p>
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
                <div className="p-8 bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 rounded-xl border-2 border-purple-300 dark:border-purple-700 shadow-lg">
                  <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-700 to-indigo-700 mb-3">Find Collaborators</h2>
                  <p className="text-base text-gray-800 dark:text-gray-200 font-semibold">Researchers and institutions actively working on the identified gaps in your field</p>
                </div>

                {gaps.length > 0 ? (
                  <div className="space-y-6">
                    {gaps.map((gap, gapIdx) => (
                      <div key={gapIdx} className="border-2 border-purple-200 dark:border-purple-700 rounded-xl overflow-hidden shadow-lg">
                        <div className="p-6 bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/20 dark:to-indigo-900/20 border-b-2 border-purple-300 dark:border-purple-700">
                          <h3 className="font-bold text-gray-900 dark:text-white text-xl mb-2">{gap.title}</h3>
                          <p className="text-sm text-gray-700 dark:text-gray-300 italic">{gap.research_question}</p>
                        </div>

                        <div className="p-6 space-y-4">
                          {collaborators[gap.title] && collaborators[gap.title].length > 0 ? (
                            <div className="space-y-4">
                              {collaborators[gap.title].map((collab, idx) => (
                                <div key={idx} className="group bg-white dark:bg-gray-800 rounded-lg border-2 border-purple-150 dark:border-purple-700/50 hover:border-purple-400 dark:hover:border-purple-500 transition-all hover:shadow-xl overflow-hidden transform hover:scale-102">
                                  {/* Header */}
                                  <div className="p-5 border-b-2 border-purple-150 dark:border-purple-700/50 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/15 dark:to-indigo-900/15">
                                    <div className="flex items-start gap-3 mb-2">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-gray-900 dark:text-white text-lg mb-1">{collab.name}</p>
                                        {collab.institution && (
                                          <p className="text-sm text-purple-700 dark:text-purple-400 font-semibold">
                                            {collab.institution}
                                            {collab.location && ` • ${collab.location}`}
                                          </p>
                                        )}
                                        {collab.citedBy && (
                                          <p className="text-xs text-indigo-700 dark:text-indigo-400 font-bold mt-2">
                                            {collab.citedBy.toLocaleString()} Citations
                                            {collab.workCount && ` • ${collab.workCount} Works`}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Links */}
                                  <div className="p-5">
                                    <p className="text-xs font-bold text-purple-700 dark:text-purple-300 mb-4 uppercase tracking-widest">Connect & Explore</p>
                                    <div className="grid grid-cols-2 gap-3">
                                      {collab.type === 'Lab/Institution' ? (
                                        <>
                                          {collab.website && (
                                            <a
                                              href={collab.website}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                            >
                                              Website
                                            </a>
                                          )}
                                          {collab.url && (
                                            <a
                                              href={`https://ror.org/${collab.url.split('/').pop()}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                            >
                                              ROR Profile
                                            </a>
                                          )}
                                          <a
                                            href={`https://scholar.google.com/scholar?q="${encodeURIComponent(collab.name)}"`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                          >
                                            Google Scholar
                                          </a>
                                          <a
                                            href={`https://www.researchgate.net/search?q="${encodeURIComponent(collab.name)}"`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                          >
                                            ResearchGate
                                          </a>
                                        </>
                                      ) : (
                                        <>
                                          <a
                                            href={collab.scholarUrl || `https://scholar.google.com/scholar?q="${encodeURIComponent(collab.name)}"`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                          >
                                            Google Scholar
                                          </a>
                                          <a
                                            href={`https://www.researchgate.net/search?q="${encodeURIComponent(collab.name)}"`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                          >
                                            ResearchGate
                                          </a>
                                          <a
                                            href={`https://orcid.org/search/orcid/${encodeURIComponent(collab.name)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                          >
                                            ORCID
                                          </a>
                                          <a
                                            href={`https://www.linkedin.com/search/results/people/?keywords="${encodeURIComponent(collab.name)}"`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg text-sm font-bold transition transform hover:scale-105 shadow-md"
                                          >
                                            LinkedIn
                                          </a>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-6 bg-gradient-to-br from-orange-50 to-yellow-50 dark:from-orange-900/10 dark:to-yellow-900/10 rounded-lg border-2 border-orange-200 dark:border-orange-900/30 text-center">
                              <p className="text-gray-700 dark:text-gray-300 font-semibold mb-4">No recent researchers found, but explore this gap:</p>
                              <div className="flex flex-wrap gap-2 justify-center">
                                <a
                                  href={`https://scholar.google.com/scholar?q="${encodeURIComponent(gap.research_question)}"`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
                                >
                                  Google Scholar
                                </a>
                                <a
                                  href={`https://www.semanticscholar.org/search?q="${encodeURIComponent(gap.research_question)}"`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 transition"
                                >
                                  📚 Semantic Scholar
                                </a>
                                <a
                                  href={`https://www.researchgate.net/search?q="${encodeURIComponent(gap.research_question)}"`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition"
                                >
                                  ResearchGate
                                </a>
                              </div>
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
