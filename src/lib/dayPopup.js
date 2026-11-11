import { createContext, useContext } from 'react';

/** Opens a day's diary in a pop-up from anywhere (provided by the Layout). */
export const DayPopupContext = createContext((date) => { window.location.hash = `#/diary/${date}`; });
export const useOpenDay = () => useContext(DayPopupContext);

/** Opens a period's review (weekly, monthly …) in a pop-up from anywhere (provided by the Layout). */
export const ReviewPopupContext = createContext((p) => { window.location.hash = `#/review/${p.type}/${p.id}`; });
export const useOpenReview = () => useContext(ReviewPopupContext);
