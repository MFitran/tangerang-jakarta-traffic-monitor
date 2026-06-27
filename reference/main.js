document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('linkedin-posts-container');
    if (container) {
        fetchAndRenderSupabasePosts(container);
    }
});

window.envConfig = null;
let fetchConfigPromise = null;

async function fetchEnvConfig() {
    if (window.envConfig) return window.envConfig;
    if (fetchConfigPromise) return fetchConfigPromise;

    fetchConfigPromise = (async () => {
        try {
            const response = await fetch(`supabase-config.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            window.envConfig = await response.json();
            return window.envConfig;
        } catch (err) {
            console.error("Failed to load supabase configuration from supabase-config.json:", err);
            return null;
        } finally {
            fetchConfigPromise = null;
        }
    })();

    return fetchConfigPromise;
}

window.getSupabaseClient = async function(customOptions = null) {
    const config = await fetchEnvConfig();
    if (!config || !window.supabase) {
        return null;
    }

    if (customOptions) {
        return window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_KEY, customOptions);
    }

    if (window.supabaseClient) return window.supabaseClient;

    window.supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
    return window.supabaseClient;
}

async function fetchAndRenderSupabasePosts(container) { // This function remains async due to the database call
    const config = await fetchEnvConfig();
    if (!window.supabase || !config?.SUPABASE_URL || !config?.SUPABASE_KEY) {
        console.error("Supabase client or configuration not found.");
        container.innerHTML = '<div style="text-align: center; width: 100%; grid-column: 1 / -1; color: red;">Error loading updates.</div>';
        return;
    }

    // Create a dedicated public client to avoid using the logged-in user session 
    // which might lack permission or have expired JWT errors.
    const client = window.supabase.createClient(
        config.SUPABASE_URL, 
        config.SUPABASE_KEY, 
        { 
            auth: { 
                persistSession: false,
                storageKey: 'sb-linkedin-posts-auth-token'
            } 
        }
    );

    // Determine limit dynamically (default to 3, but allow 'all')
    const limitAttr = container.getAttribute('data-limit');
    const limit = limitAttr === 'all' ? 100 : (parseInt(limitAttr) || 3);

    try {
        const { data: posts, error } = await client
            .from('linkedin_posts')
            .select('*')
            .order('posted_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        container.innerHTML = ''; // clear loading text

        if (!posts || posts.length === 0) {
            container.innerHTML = '<div style="text-align: center; width: 100%; grid-column: 1 / -1; color: #666;">No updates found.</div>';
            return;
        }

        posts.forEach(post => {
            const card = document.createElement('div');
            card.className = 'box update-box';
            
            // Limit content length for preview
            const textContent = post.content || '';
            const previewLength = 150;
            let contentHtml = '';

            // Escape HTML and format newlines to <br> safely
            const escapeHTML = str => str.replace(/[&<>'"]/g, 
                tag => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    "'": '&#39;',
                    '"': '&quot;'
                }[tag])
            );
            const safeText = escapeHTML(textContent);

            if (safeText.length > previewLength) {
                const fullText = safeText.replace(/\n/g, '<br>');
                contentHtml = `<div class="post-text-content">${fullText}</div><button class="read-more-btn">Read more</button>`;
            } else {
                contentHtml = `<div>${safeText.replace(/\n/g, '<br>')}</div>`;
            }

            const dateStr = post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'N/A';
            const imageUrl = post.first_image_url || 'assets/default_linkedin_post_image.jpeg';
            const labelText = post.is_repost ? 'Repost' : 'Post';

            // Determine if the image needs dynamic loading because of private bucket policies
            const isSupabaseImage = imageUrl.includes('/linkedin-images/');
            const initialSrc = isSupabaseImage ? 'assets/default_linkedin_post_image.jpeg' : imageUrl;

            card.innerHTML = `
                <div class="post-label">${labelText}</div>
                <img class="post-image" src="${initialSrc}" alt="LinkedIn Post Image" onerror="this.onerror=null; this.src='assets/default_linkedin_post_image.jpeg';">
                <div class="post-desc">${contentHtml}</div>
                <div class="post-stats">
                    <span>👍 ${post.likes_count || 0}</span>
                    <span>💬 ${post.comments_count || 0}</span>
                    <span>🔄 ${post.shares_count || 0}</span>
                    <span style="margin-left: auto;">📅 ${dateStr}</span>
                </div>
                <a href="${post.post_url || '#'}" target="_blank" class="post-btn">View on LinkedIn</a>
            `;

            // Download private image asynchronously and replace src once loaded
            if (isSupabaseImage) {
                const parts = imageUrl.split('/linkedin-images/');
                if (parts.length > 1) {
                    const filename = parts[1].split('?')[0];
                    client.storage
                        .from('linkedin-images')
                        .download(filename)
                        .then(({ data, error }) => {
                            if (!error && data) {
                                const blobUrl = URL.createObjectURL(data);
                                const imgEl = card.querySelector('.post-image');
                                if (imgEl) {
                                    imgEl.src = blobUrl;
                                }
                            } else if (error) {
                                console.error(`Error downloading image ${filename}:`, error.message);
                            }
                        });
                }
            }

            // Add event listener for 'Read more' toggle
            const readMoreLink = card.querySelector('.read-more-btn');
            if (readMoreLink) {
                readMoreLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    const textContent = card.querySelector('.post-text-content');
                    const isExpanded = textContent.classList.contains('expanded');
                    
                    if (isExpanded) {
                        textContent.classList.remove('expanded');
                        readMoreLink.textContent = 'Read more';
                    } else {
                        textContent.classList.add('expanded');
                        readMoreLink.textContent = 'Read less';
                    }

                    // Force the card to adapt its height to the new content
                    card.style.height = 'auto';
                });
            }
            
            container.appendChild(card);
        });

    } catch (err) {
        console.error("Error fetching posts from Supabase:", err.message);
        container.innerHTML = '<div style="text-align: center; width: 100%; grid-column: 1 / -1; color: red;">Error loading updates. Please try again later.</div>';
    }
}
