const target = document.querySelector('.retention-section');

document.addEventListener('scroll', () => {
    if (!target) return;

    const rect = target.getBoundingClientRect();
    
    // Calculate multiplier only when the title is at or above the top of the screen.
    // rect.top is the distance from the top of the viewport.
    // When rect.top is <= 0, the element is at or above the top of the screen.
    let multiplier = 0;
    if (rect.top <= 0) {
        // rect.top becomes more negative as we scroll down past it.
        // We use Math.abs to get the positive distance scrolled past.
        multiplier = Math.abs(rect.top) * 0.1;
    }
    
    document.documentElement.style.setProperty('--scrollMultiplier', `${multiplier}px`);
});

// GSAP Animation for Notification Cards
document.addEventListener("DOMContentLoaded", (event) => {
    // Check for deeplink URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const deeplink = urlParams.get('deeplink');

    if (deeplink && deeplink.trim() !== '') {
        const headerCta = document.querySelector('.header-cta');
        if (headerCta) {
            headerCta.href = deeplink;
        }
    }
		gsap.fromTo(".hero-content", {
        opacity: 0,
			},{
			opacity: 1,
			duration: 0.3,
			ease: "power3.out",
			delay: 0
			});
    gsap.fromTo(".hero-content > div", {
        y: 100,
        opacity: 0,
        duration: 1.2,
        ease: "power3.out",
			},{
				y: 0,
				opacity: 1,
				duration: 1.2,
				ease: "power3.out",
				delay: 0,
				stagger: 0.3
			});

    gsap.fromTo(".notification-card", {
        y: 50,
        opacity: 0,
    },{
			y: 0,
			opacity: 1,
			duration: 0.8,
			ease: "power2.out",
			delay: 1.2,
			stagger: 0.2
		});

    gsap.fromTo(".phone-frame", {
        opacity: 0,
			},{
			opacity: 1,
			duration: 0.3,
			ease: "power3.out",
			delay: 0
			});
    gsap.fromTo(".phone-frame > div", {
        y: 100,
        opacity: 0,
        duration: 1.2,
        ease: "power3.out",
			},{
				y: 0,
				opacity: 1,
				duration: 1.2,
				ease: "power3.out",
				delay: 0.4,
				stagger: 0.4
			});
});
